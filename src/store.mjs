import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { classifySessions, readEvidence } from './sessions.mjs';
import { pathKey, pathsEqual } from './paths.mjs';

const MAX_PARALLEL_READS = 6;

async function discover(directory, { recursive, signal, onSkip, readDirectory }) {
  signal?.throwIfAborted();
  const entries = await readDirectory(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    if (recursive && entry.isDirectory()) {
      // 单个子目录不可读只影响它自己，其余会话照常返回。
      try { files.push(...await discover(path, { recursive, signal, onSkip, readDirectory })); }
      catch { signal?.throwIfAborted(); onSkip?.(); }
    }
  }
  return files;
}

export function createSessionStore({ readDirectory = readdir } = {}) {
  const cache = new Map();
  let readCount = 0;
  async function read(path, signal) {
    const stats = await stat(path), id = pathKey(path), previous = cache.get(id);
    if (previous?.size === stats.size && previous?.mtimeMs === stats.mtimeMs) return previous;
    const evidence = await readEvidence(path, signal);
    readCount++;
    const time = evidence.activity || Date.parse(evidence.header.timestamp) || stats.mtimeMs;
    const record = { size: stats.size, mtimeMs: stats.mtimeMs, evidence,
      item: { path, id: evidence.header.id,
        cwd: typeof evidence.header.cwd === 'string' ? evidence.header.cwd : '',
        parentSessionPath: typeof evidence.header.parentSession === 'string' ? evidence.header.parentSession : undefined,
        name: evidence.name, firstMessage: evidence.firstMessage,
        messageCount: evidence.messageCount, modified: new Date(time) } };
    cache.set(id, record);
    return record;
  }
  return {
    get readCount() { return readCount; },
    get cachedCount() { return cache.size; },
    async list({ directory, recursive = false, cwd, signal, onProgress, onDiagnostics, progressText }) {
      let unreadable = 0;
      const files = await discover(directory, { recursive, signal, readDirectory,
        onSkip: () => { unreadable++; } });
      const records = new Array(files.length);
      let next = 0, loaded = 0;
      await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_READS, files.length) }, async () => {
        while (next < files.length) {
          signal?.throwIfAborted();
          const index = next++;
          try { records[index] = await read(files[index], signal); }
          catch { signal?.throwIfAborted(); unreadable++; }
          loaded++;
          onProgress?.(progressText ? progressText(loaded, files.length, unreadable)
            : `读取 ${loaded}/${files.length}${unreadable ? ` · 跳过不可读 ${unreadable}` : ''}`);
        }
      }));
      const available = records.filter(Boolean);
      const items = available.map(record => record.item).filter(item => !cwd || pathsEqual(item.cwd, cwd));
      const evidence = new Map(available.map(record => [record.item.path, record.evidence]));
      // 单目录外的父会话也用相同 stat 缓存，仅用于分类，不加入可恢复列表。
      // 与主列表一样走有限并发，避免外部父记录较多时串行读取。
      const known = new Set([...evidence.keys()].map(pathKey));
      const parents = [...new Set(items.map(item => item.parentSessionPath).filter(Boolean))]
        .filter(parent => !known.has(pathKey(parent)));
      let parentIndex = 0;
      await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_READS, parents.length) }, async () => {
        while (parentIndex < parents.length) {
          signal?.throwIfAborted();
          const parent = parents[parentIndex++];
          try { evidence.set(parent, (await read(parent, signal)).evidence); }
          catch { signal?.throwIfAborted(); }
        }
      }));
      // 每次列举都淘汰本次结果之外的缓存；外部父记录仍按 stat 校验后复用。
      const retained = new Set([...files, ...evidence.keys()].map(pathKey));
      for (const path of cache.keys()) if (!retained.has(path)) cache.delete(path);
      const classified = await classifySessions(items, { signal, evidence });
      onDiagnostics?.({ unreadable });
      return classified;
    },
  };
}
