import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { classifySessions, readEvidence } from './sessions.mjs';

const key = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
// 与 Pi 一致：缺失或空 cwd 视为未知，不能折叠成进程工作目录。
const sameCwd = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a !== '' && b !== '' && key(a) === key(b);
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
    const stats = await stat(path), id = key(path), previous = cache.get(id);
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
    async list({ directory, recursive = false, cwd, signal, onProgress, onDiagnostics }) {
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
          onProgress?.(`读取 ${++loaded}/${files.length}${unreadable ? ` · 跳过不可读 ${unreadable}` : ''}`);
        }
      }));
      const available = records.filter(Boolean);
      const items = available.map(record => record.item).filter(item => !cwd || sameCwd(item.cwd, cwd));
      const evidence = new Map(available.map(record => [record.item.path, record.evidence]));
      // 单目录外的父会话也用相同 stat 缓存，仅用于分类，不加入可恢复列表。
      for (const parent of new Set(items.map(item => item.parentSessionPath).filter(Boolean))) {
        signal?.throwIfAborted();
        if (evidence.has(parent)) continue;
        try { evidence.set(parent, (await read(parent, signal)).evidence); }
        catch { signal?.throwIfAborted(); }
      }
      // 不保留已删除文件的缓存；外部父记录仍按 stat 校验后复用。
      if (recursive) {
        const retained = new Set([...files, ...evidence.keys()].map(key));
        for (const path of cache.keys()) if (!retained.has(path)) cache.delete(path);
      }
      const classified = await classifySessions(items, { signal, evidence });
      onDiagnostics?.({ unreadable });
      return classified;
    },
  };
}
