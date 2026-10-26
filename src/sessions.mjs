import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { pathKey } from './paths.mjs';

export const cleanText = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();

// 只把整条消息均为单个附件路径的情况当作附件，不误改普通文字中的路径。
export function attachmentName(message) {
  const value = String(message ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!/^(?:[a-z]:[/\\]|\/|file:\/\/)/i.test(value)
      || /[\r\n]/.test(value)
      || !/\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|txt|csv|docx?|xlsx?|pptx?|zip)$/i.test(value)) return undefined;
  return value.split(/[/\\]/).at(-1);
}

export function sessionTitle(item, { image = '图片', attachment = '附件' } = {}) {
  if (cleanText(item.name)) return cleanText(item.name);
  const file = attachmentName(item.firstMessage);
  if (file) {
    const isImage = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file);
    // 剪贴板临时文件的 UUID 无助于辨认，把原路径留在详情预览。
    if (/^pi-clipboard-[\da-f-]+\.(?:png|jpe?g|gif|webp|bmp)$/i.test(file)) return image;
    return `${isImage ? image : attachment}: ${cleanText(file)}`;
  }
  return cleanText(item.firstMessage) || basename(item.path, '.jsonl');
}

// 搜索文本只在加载时构造一次，供选择器在每次按键时复用。
export function sessionSearchText(item, labels) {
  return `${sessionTitle(item, labels)} ${item.cwd ?? ''} ${item.firstMessage ?? ''}`.toLocaleLowerCase();
}

export function selectSessions(items, { query = '', showAgents = false, sorted = false } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matched = items.filter(item => {
    if (!showAgents && item.isSubagent) return false;
    if (terms.length === 0) return true;
    const text = item.searchText ?? sessionSearchText(item);
    return terms.every(term => text.includes(term));
  });
  // 选择器在加载时已完成排序，刷新/搜索时无需重复排序。
  return sorted ? matched : matched.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

// 流式提取列表和分类元数据，不保留完整对话正文。
export async function readEvidence(path, signal) {
  const input = createReadStream(path, { encoding: 'utf8', signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const evidence = { initialName: undefined, calls: new Set(), header: undefined,
    name: undefined, messageCount: 0, firstMessage: '', activity: 0 };
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      // 逐行验证 JSON，只统计顶层消息；解析结果不会进入缓存。
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== 'object') continue;
      if (entry.type === 'message') evidence.messageCount++;
      if (entry.type === 'session') evidence.header = entry;
      if (entry.type === 'session_info') {
        if (evidence.initialName === undefined) evidence.initialName = entry.name;
        evidence.name = entry.name;
      }
      const message = entry.type === 'message' ? entry.message : undefined;
      if (message?.role === 'user' || message?.role === 'assistant') {
        const time = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(entry.timestamp);
        if (Number.isFinite(time)) evidence.activity = Math.max(evidence.activity, time);
      }
      if (message?.role === 'user' && !evidence.firstMessage) {
        const content = message.content;
        evidence.firstMessage = (typeof content === 'string' ? content :
          Array.isArray(content) ? content.filter(b => b && typeof b === 'object'
            && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join(' ') : '').slice(0, 600);
      }
      const details = message?.details;
      if (message?.role === 'toolResult' && message.toolName === 'Agent'
          && typeof details?.agentId === 'string' && typeof details?.subagentType === 'string') {
        evidence.calls.add(`${details.subagentType}#${details.agentId.slice(0, 8)}`);
      }
    }
    if (!evidence.header) throw new Error('Session header missing');
    return evidence;
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function classifySessions(items, { signal, onProgress, evidence } = {}) {
  signal?.throwIfAborted();
  const cache = new Map(evidence ? [...evidence].map(([path, value]) => [pathKey(path), Promise.resolve(value)]) : []);
  const read = path => {
    const key = pathKey(path);
    if (!cache.has(key)) cache.set(key, readEvidence(path, signal));
    return cache.get(key);
  };
  const result = [];
  for (const item of items) {
    signal?.throwIfAborted();
    let classification = 'user', classificationReason = item.parentSessionPath ? 'ordinaryBranch' : 'noParent';
    if (item.parentSessionPath) {
      try {
        const child = await read(item.path);
        if (typeof child.initialName === 'string' && /#[a-f0-9]{8}$/i.test(child.initialName)) {
          classificationReason = 'parentUnavailable';
          const parent = await read(item.parentSessionPath);
          if (parent.calls.has(child.initialName)) {
            classification = 'subagent'; classificationReason = 'verified';
          } else {
            classification = 'unknown'; classificationReason = 'noMatchingCall';
          }
        }
      } catch {
        signal?.throwIfAborted();
        classification = 'unknown';
        if (classificationReason !== 'parentUnavailable') classificationReason = 'childUnavailable';
      }
    }
    result.push({ ...item, classification, classificationReason, isSubagent: classification === 'subagent' });
    onProgress?.(result.length, items.length);
  }
  return result;
}
