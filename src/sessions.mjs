import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { pathKey } from './paths.mjs';

import { cleanText, attachmentContext, userMessageContext } from './attachments.mjs';
export { cleanText } from './attachments.mjs';

export function sessionContext(item) {
  const opening = attachmentContext(item.firstMessage);
  return {
    request: item.firstRequest ?? opening.text,
    latest: item.latestRequest ?? '',
    attachments: item.attachments ?? { images: opening.images, files: opening.files, names: opening.names },
  };
}

export function sessionTitle(item, { image = '图片', attachment = '附件' } = {}) {
  const name = cleanText(item.name), named = attachmentContext(name);
  // 路径式自动名称不覆盖有效上下文；真正的用户名称始终保留。
  if (name && (!named.images && !named.files || named.text)) return name;
  const context = sessionContext(item);
  const info = context.attachments;
  const count = info.images + info.files;
  const label = info.files ? attachment : image;
  const marker = count > 1 ? `${label} ×${count}` : label;
  if (context.request) return count ? `[${marker}] ${cleanText(context.request)}` : cleanText(context.request);
  if (count) {
    const meaningful = info.names.filter(file => !/^pi-clipboard-[\da-f-]+\./i.test(file));
    if (meaningful.length) return `[${marker}] ${meaningful.join(', ')}`;
    const date = item.modified;
    const time = date && Number.isFinite(date.getTime())
      ? `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
    return `[${marker}]${time ? ` ${time}` : ''}`;
  }
  return name || basename(item.path, '.jsonl');
}

// 搜索文本只在加载时构造一次，供选择器在每次按键时复用。
export function sessionSearchText(item, labels) {
  return `${sessionTitle(item, labels)} ${item.name ?? ''} ${item.cwd ?? ''} ${item.firstMessage ?? ''} ${item.firstRequest ?? ''} ${item.latestRequest ?? ''} ${item.attachments?.names?.join(' ') ?? ''}`.toLocaleLowerCase();
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
    name: undefined, messageCount: 0, firstMessage: '', firstRequest: '', latestRequest: '',
    attachments: { images: 0, files: 0, names: [] }, activity: 0 };
  let openingSeen = false;
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
      if (message?.role === 'user') {
        const context = userMessageContext(message.content);
        if (!openingSeen) {
          evidence.firstMessage = context.raw;
          evidence.attachments = { images: context.images, files: context.files, names: context.names };
          openingSeen = true;
        }
        if (context.text) {
          if (!evidence.firstRequest) evidence.firstRequest = context.text.slice(0, 600);
          evidence.latestRequest = context.text.slice(0, 600);
        }
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
