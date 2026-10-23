import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, resolve } from 'node:path';

export const cleanText = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();

export function sessionTitle(item) {
  return cleanText(item.name) || cleanText(item.firstMessage) || basename(item.path, '.jsonl');
}

export function selectSessions(items, { query = '', showAgents = false } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (!showAgents && item.isSubagent) return false;
    const text = `${sessionTitle(item)} ${item.cwd} ${item.firstMessage ?? ''}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

const pathKey = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

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
          Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '').slice(0, 600);
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
    let classification = 'user';
    if (item.parentSessionPath) {
      try {
        const child = await read(item.path);
        if (typeof child.initialName === 'string' && /#[a-f0-9]{8}$/i.test(child.initialName)) {
          const parent = await read(item.parentSessionPath);
          if (parent.calls.has(child.initialName)) classification = 'subagent';
          else classification = 'unknown';
        }
      } catch {
        signal?.throwIfAborted();
        classification = 'unknown';
      }
    }
    result.push({ ...item, classification, isSubagent: classification === 'subagent' });
    onProgress?.(result.length, items.length);
  }
  return result;
}
