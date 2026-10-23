import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sessions from '../src/sessions.mjs';

const item = (path, extra = {}) => ({ path, cwd: '/project', name: path,
  modified: new Date('2026-10-23'), messageCount: 2, firstMessage: '', ...extra });
const header = (id, parentSession) => ({ type: 'session', id, parentSession });
const named = name => ({ type: 'session_info', name });
const agent = (agentId, subagentType = 'Explore') => ({ type: 'message', message: {
  role: 'toolResult', toolName: 'Agent', details: { agentId, subagentType } } });

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-session-manager-test-'));
  const file = async (name, entries) => {
    const path = join(dir, `${name}.jsonl`);
    await writeFile(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    return path;
  };
  try { await run(file); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('只隐藏有父会话 Agent 调用证据的子会话，保留 fork 和名字碰巧相同的会话', async () => {
  await fixture(async file => {
    const parent = await file('main', [header('main'), agent('abc12345-1234')]);
    const child = await file('agent', [header('child', parent), named('Explore#abc12345')]);
    const fork = await file('fork', [header('fork', parent), named('手动分支')]);
    const lookalike = await file('lookalike', [header('other', parent), named('Explore#ffffffff')]);
    const result = await sessions.classifySessions([
      item(parent), item(child, { parentSessionPath: parent }),
      item(fork, { parentSessionPath: parent }), item(lookalike, { parentSessionPath: parent }),
    ]);
    assert.deepEqual(result.filter(s => s.isSubagent).map(s => s.path), [child]);
  });
});

test('已改名子 Agent 仍可识别，手动从该 Agent fork 的会话保留', async () => {
  await fixture(async file => {
    const parent = await file('main', [header('main'), agent('abc12345-1234')]);
    const child = await file('agent', [header('child', parent), named('Explore#abc12345'), named('审查结果')]);
    const fork = await file('fork', [header('fork', child), named('Explore#abc12345'), named('继续讨论')]);
    const result = await sessions.classifySessions([
      item(child, { parentSessionPath: parent, name: '审查结果' }),
      item(fork, { parentSessionPath: child, name: '继续讨论' }),
    ]);
    assert.equal(result[0].isSubagent, true);
    assert.equal(result[1].isSubagent, false);
  });
});

test('缺失或损坏父会话不隐藏候选，并反馈未核验数量', async () => {
  await fixture(async file => {
    const child = await file('agent', [header('child', '/missing/parent.jsonl'), named('Explore#abc12345')]);
    const result = await sessions.classifySessions([item(child, { parentSessionPath: '/missing/parent.jsonl' })]);
    assert.equal(result[0].isSubagent, false);
    assert.equal(result[0].classification, 'unknown');
  });
});

test('忽略坏 JSON 行且不把普通文本里的 Agent ID 当证据', async () => {
  await fixture(async file => {
    const parent = await file('main', [header('main'), { type: 'message', message: {
      role: 'user', content: 'Agent abc12345 Explore' } }]);
    await writeFile(parent, '\ninvalid json\n', { flag: 'a' });
    const child = await file('agent', [header('child', parent), named('Explore#abc12345')]);
    const result = await sessions.classifySessions([item(child, { parentSessionPath: parent })]);
    assert.equal(result[0].isSubagent, false);
  });
});

test('恢复列表默认排除子 Agent，搜索按全部关键词匹配标题与目录，按最近排序', () => {
  const data = [item('/old', { name: '库存 核查', modified: new Date('2026-01-01') }),
    item('/new', { name: '库存 核查', modified: new Date('2026-10-23') }),
    item('/agent', { name: '库存 核查', isSubagent: true })];
  assert.deepEqual(sessions.selectSessions(data, { query: '库存 核查' }).map(s => s.path), ['/new', '/old']);
  assert.equal(sessions.selectSessions(data, { query: '库存 不存在' }).length, 0);
  assert.equal(sessions.selectSessions(data, { showAgents: true }).length, 3);
});

test('路径与第一条消息可搜索，输出标题移除控制字符并回退到文件名', () => {
  const s = item('/hello.jsonl', { name: '', firstMessage: '处理\n订单\u001b[31m' });
  assert.equal(sessions.sessionTitle(s), '处理 订单[31m');
  assert.equal(sessions.selectSessions([s], { query: 'project 订单' }).length, 1);
  assert.equal(sessions.sessionTitle(item('/hello.jsonl', { name: '', firstMessage: '' })), 'hello');
});

test('取消分类立即中断，不把取消当作无法读取', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sessions.classifySessions([item('/missing')], { signal: controller.signal }), { name: 'AbortError' });
});
