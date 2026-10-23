import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
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
