import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionStore } from '../src/store.mjs';

test('一次读取提取列表与分类证据，重复加载复用缓存，文件变化后更新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-store-'));
  try {
    const dir = join(root, 'project'); await mkdir(dir);
    const parent = join(dir, 'main.jsonl'), child = join(dir, 'child.jsonl');
    await writeFile(parent, [
      { type: 'session', id: 'main', cwd: '/project' },
      { type: 'message', message: { role: 'user', content: '处理订单' } },
      { type: 'message', message: { role: 'toolResult', toolName: 'Agent',
        details: { agentId: 'abc12345-123', subagentType: 'Explore' } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await writeFile(child, [
      { type: 'session', id: 'child', cwd: '/project', parentSession: parent },
      { type: 'session_info', name: 'Explore#abc12345' },
    ].map(JSON.stringify).join('\n') + '\n');
    const store = createSessionStore();
    let result = await store.list({ directory: dir, cwd: '/project' });
    assert.equal(result.length, 2);
    assert.equal(result.find(s => s.path === child).isSubagent, true);
    assert.equal(result.find(s => s.path === parent).firstMessage, '处理订单');
    assert.equal(result.find(s => s.path === parent).messageCount, 2);
    assert.equal(store.readCount, 2);
    await store.list({ directory: dir });
    assert.equal(store.readCount, 2);
    await appendFile(parent, JSON.stringify({ type: 'session_info', name: '新名字' }) + '\n');
    result = await store.list({ directory: dir });
    assert.equal(result.find(s => s.path === parent).name, '新名字');
    assert.equal(store.readCount, 3);
    assert.equal((await store.list({ directory: root, recursive: true })).length, 2);
    assert.equal((await store.list({ directory: dir, cwd: '/other' })).length, 0);
    await assert.rejects(store.list({ directory: join(root, 'missing') }), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('非法 cwd 类型不中断列举，未知 cwd 不匹配当前目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-store-'));
  try {
    const write = (name, header) => writeFile(join(root, `${name}.jsonl`),
      JSON.stringify({ type: 'session', ...header }) + '\n');
    await write('bad', { id: 'bad', cwd: 42 });
    await write('missing', { id: 'missing' });
    await write('ok', { id: 'ok', cwd: '/project' });
    const store = createSessionStore();
    const all = await store.list({ directory: root });
    assert.deepEqual(all.map(s => s.id).sort(), ['bad', 'missing', 'ok']);
    assert.equal(all.find(s => s.id === 'bad').cwd, '');
    const current = await store.list({ directory: root, cwd: '/project' });
    assert.deepEqual(current.map(s => s.id), ['ok']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('递归扫描跳过不可读子目录，其余会话照常返回并计入诊断', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-store-'));
  try {
    const okDir = join(root, 'ok'), blockedDir = join(root, 'blocked');
    await mkdir(okDir); await mkdir(blockedDir);
    const header = JSON.stringify({ type: 'session', id: 'ok', cwd: '/project' }) + '\n';
    await writeFile(join(okDir, 'a.jsonl'), header);
    await writeFile(join(blockedDir, 'b.jsonl'), header);
    const diagnostics = [];
    const store = createSessionStore({ readDirectory: async (dir, options) => {
      if (dir === blockedDir) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return readdir(dir, options);
    } });
    const result = await store.list({ directory: root, recursive: true,
      onDiagnostics: value => diagnostics.push(value) });
    assert.deepEqual(result.map(s => s.id), ['ok']);
    assert.deepEqual(diagnostics, [{ unreadable: 1 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('目录外父会话参与分类但不加入列表，缓存随每次列举淘汰', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-store-'));
  try {
    const project = join(root, 'project'), archive = join(root, 'archive');
    await mkdir(project); await mkdir(archive);
    const parent = join(archive, 'parent.jsonl'), child = join(project, 'child.jsonl');
    await writeFile(parent, [
      { type: 'session', id: 'parent', cwd: '/project' },
      { type: 'message', message: { role: 'toolResult', toolName: 'Agent',
        details: { agentId: 'abc12345-123', subagentType: 'Explore' } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await writeFile(child, [
      { type: 'session', id: 'child', cwd: '/project', parentSession: parent },
      { type: 'session_info', name: 'Explore#abc12345' },
    ].map(JSON.stringify).join('\n') + '\n');
    const store = createSessionStore();
    const result = await store.list({ directory: project, cwd: '/project' });
    assert.equal(result.length, 1);
    assert.equal(result[0].isSubagent, true);
    assert.equal(store.cachedCount, 2); // 子会话 + 目录外父会话
    await rm(child);
    assert.equal((await store.list({ directory: project })).length, 0);
    assert.equal(store.cachedCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('返回列表保持数组接口，同时提供最终不可读统计，修复文件后统计清零', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-store-'));
  try {
    const valid = join(root, 'valid.jsonl'), broken = join(root, 'broken.jsonl');
    const header = JSON.stringify({ type: 'session', id: 'valid', cwd: '/project' }) + '\n';
    await writeFile(valid, header);
    await writeFile(broken, 'broken JSON\n');
    const store = createSessionStore(), diagnostics = [];
    const list = () => store.list({ directory: root, onDiagnostics: value => diagnostics.push(value) });
    const result = await list();
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 1);
    assert.deepEqual(diagnostics, [{ unreadable: 1 }]);
    await writeFile(broken, header);
    assert.equal((await list()).length, 2);
    assert.deepEqual(diagnostics.at(-1), { unreadable: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
