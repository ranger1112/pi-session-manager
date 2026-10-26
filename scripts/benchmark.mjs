#!/usr/bin/env node
/**
 * Reproducible synthetic baseline for the session store.
 *
 * This generates only temporary JSONL fixtures; it never reads Pi history.  Its
 * figures describe these fixtures, not performance on a user's real history.
 *
 * Examples:
 *   node scripts/benchmark.mjs
 *   node scripts/benchmark.mjs --sizes 25,100
 *   node scripts/benchmark.mjs --small
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSessionStore } from '../src/store.mjs';
import { readEvidence, sessionSearchText, selectSessions } from '../src/sessions.mjs';

const DEFAULT_SIZES = [1_000, 10_000];
const BODY = '合成正文：用于稳定覆盖 JSONL 解析、列表缓存与搜索路径。'.repeat(12);
const CANCEL_BODY = '取消读取探针：这不是会话历史。'.repeat(300_000);
const WRITE_CONCURRENCY = 16;

function parseSizes(argv) {
  if (argv.includes('--small')) return [25, 100];
  const position = argv.indexOf('--sizes');
  if (position === -1) return DEFAULT_SIZES;
  const raw = argv[position + 1];
  if (!raw) throw new Error('--sizes needs a comma-separated positive integer list, e.g. 25,100');
  const sizes = raw.split(',').map(value => Number(value.trim()));
  if (!sizes.length || sizes.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('--sizes must contain positive integers');
  }
  return sizes;
}

function elapsed(start) {
  return Number((performance.now() - start).toFixed(2));
}

function sessionLines({ id, index, parentSession }) {
  const timestamp = new Date(1_700_000_000_000 + index * 1_000).toISOString();
  const firstMessage = index % 7 === 0
    ? [{ type: 'text', text: `附件首消息 synthetic-${index} 搜索词 mango` }, { type: 'image', source: 'fixture' }]
    : `用户合成请求 ${index}，搜索词 ${index % 3 === 0 ? 'mango' : 'citrus'}`;
  const lines = [
    { type: 'session', id, cwd: '/synthetic/project', timestamp, ...(parentSession ? { parentSession } : {}) },
    { type: 'message', timestamp, message: { role: 'user', content: firstMessage } },
    { type: 'message', timestamp, message: { role: 'assistant', content: BODY } },
  ];
  if (index % 5 === 0) lines.splice(1, 0, { type: 'session_info', name: `命名合成会话 ${index}` });
  return lines;
}

async function forEachLimited(count, limit, callback) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) await callback(next++);
  }));
}

async function generateFixture(root, count) {
  const directory = join(root, 'sessions');
  await mkdir(directory);
  await forEachLimited(count, WRITE_CONCURRENCY, async index => {
    const id = `synthetic-${index.toString().padStart(6, '0')}`;
    const isChild = index > 0 && index % 20 === 1;
    const parentIndex = index - 1;
    const parentPath = join(directory, `synthetic-${parentIndex.toString().padStart(6, '0')}.jsonl`);
    const lines = sessionLines({ id, index, parentSession: isChild ? parentPath : undefined });
    if (isChild) {
      const agentId = parentIndex.toString(16).padStart(8, '0');
      lines.splice(1, 0, { type: 'session_info', name: `Explore#${agentId}` });
    }
    // Parents carry Agent evidence for a regular, fixed fraction of child samples.
    if (index % 20 === 0 && index + 1 < count) {
      const agentId = index.toString(16).padStart(8, '0');
      lines.push({ type: 'message', timestamp: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        message: { role: 'toolResult', toolName: 'Agent', details: { subagentType: 'Explore', agentId: `${agentId}-fixture` } } });
    }
    await writeFile(join(directory, `${id}.jsonl`), `${lines.map(JSON.stringify).join('\n')}\n`);
  });
  const cancelPath = join(root, 'cancel-read.jsonl');
  await writeFile(cancelPath, `${JSON.stringify({ type: 'session', id: 'cancel-probe', cwd: '/synthetic/project' })}\n${JSON.stringify({ type: 'message', message: { role: 'assistant', content: CANCEL_BODY } })}\n`);
  return { directory, cancelPath, expectedSubagents: Math.floor((count + 18) / 20) };
}

async function measureCancellation(path) {
  const controller = new AbortController();
  const pending = readEvidence(path, controller.signal);
  // This measures stream-read cancellation after abort, not interruption of synchronous JSON.parse.
  await new Promise(resolve => setImmediate(resolve));
  const abortStart = performance.now();
  controller.abort();
  try {
    await pending;
    return { streamReadCancellationMilliseconds: elapsed(abortStart), abortError: false };
  } catch (error) {
    return { streamReadCancellationMilliseconds: elapsed(abortStart), abortError: error?.name === 'AbortError' };
  }
}

async function benchmark(count) {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-benchmark-'));
  try {
    const fixture = await generateFixture(root, count);
    const store = createSessionStore();
    const coldStart = performance.now();
    const cold = await store.list({ directory: fixture.directory });
    const coldMilliseconds = elapsed(coldStart);
    const readsAfterCold = store.readCount;

    const warmStart = performance.now();
    const warm = await store.list({ directory: fixture.directory });
    const warmMilliseconds = elapsed(warmStart);
    const readsAfterWarm = store.readCount;

    const prepareStart = performance.now();
    const searchable = warm.map(item => ({ ...item, searchText: sessionSearchText(item) }));
    const prepareMilliseconds = elapsed(prepareStart);
    const searchStart = performance.now();
    const matches = selectSessions(searchable, { query: 'mango synthetic', showAgents: true, sorted: true });
    const queryMilliseconds = elapsed(searchStart);
    const cancellation = await measureCancellation(fixture.cancelPath);
    const observedSubagents = cold.filter(item => item.isSubagent).length;
    const expectedSearchMatches = Math.floor((count - 1) / 3) + 1
      + Math.floor((count - 1) / 7) + 1 - (Math.floor((count - 1) / 21) + 1);
    if (cold.length !== count || readsAfterCold !== count) {
      throw new Error(`cold list mismatch: expected count/readCount ${count}, received ${cold.length}/${readsAfterCold}`);
    }
    if (warm.length !== count || readsAfterWarm !== readsAfterCold) {
      throw new Error(`warm list mismatch: expected count/readCount ${count}/${readsAfterCold}, received ${warm.length}/${readsAfterWarm}`);
    }
    if (observedSubagents !== fixture.expectedSubagents) {
      throw new Error(`classification mismatch: expected ${fixture.expectedSubagents}, received ${observedSubagents}`);
    }
    if (matches.length !== expectedSearchMatches) {
      throw new Error(`search mismatch: expected ${expectedSearchMatches}, received ${matches.length}`);
    }
    if (!cancellation.abortError) throw new Error('stream read cancellation did not reject with AbortError');

    return {
      sessions: count,
      synthetic: { bodyCharactersPerAssistant: BODY.length, namedEvery: 5, attachmentFirstMessageEvery: 7, parentAgentEvidenceEvery: 20, writeConcurrency: WRITE_CONCURRENCY },
      coldList: { milliseconds: coldMilliseconds, count: cold.length, readCount: readsAfterCold },
      warmList: { milliseconds: warmMilliseconds, count: warm.length, readCount: readsAfterWarm, cacheHits: count },
      classification: { expectedSubagents: fixture.expectedSubagents, observedSubagents },
      search: { prepareMilliseconds, queryMilliseconds, query: 'mango synthetic', expectedCount: expectedSearchMatches, count: matches.length },
      cancellation,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const sizes = parseSizes(process.argv.slice(2));
  const results = [];
  for (const size of sizes) results.push(await benchmark(size));
  console.log(JSON.stringify({
    node: process.version,
    note: 'Synthetic fixtures only: these results are reproducible baselines, not real-history performance or pass/fail thresholds.',
    results,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
