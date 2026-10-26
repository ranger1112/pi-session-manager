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

test('消息计数只统计合法顶层消息，忽略嵌套字段、坏行和非对象 JSON', async () => {
  await fixture(async file => {
    const path = await file('count', [header('count'),
      { type: 'message', message: { role: 'user', content: '首条消息' } },
      { type: 'custom', data: { type: 'message' } },
      { type: 'message', message: { role: 'assistant', content: [] } },
      null, [], 'message', 123,
    ]);
    await writeFile(path, 'invalid {"type":"message"}\n{"type":"message",}\n', { flag: 'a' });
    const evidence = await sessions.readEvidence(path);
    assert.equal(evidence.messageCount, 2);
    assert.equal(evidence.firstMessage, '首条消息');
  });
});

test('合法转义类型和大型工具结果正常计数，正文不保留在提取结果中', async () => {
  await fixture(async file => {
    const path = await file('large', [header('large'),
      { type: 'message', message: { role: 'toolResult', toolName: 'read',
        content: [{ type: 'text', text: 'x'.repeat(128 * 1024) }] } },
    ]);
    await writeFile(path, '{"type":"mess\\u0061ge","message":{"role":"user","content":"转义消息"}}\n', { flag: 'a' });
    const evidence = await sessions.readEvidence(path);
    assert.equal(evidence.messageCount, 2);
    assert.equal(evidence.firstMessage, '转义消息');
    assert.ok(JSON.stringify(evidence).length < 1024);
  });
});

test('预计算搜索文本优先于默认拼装，sorted 跳过重复排序', () => {
  const prepared = [
    item('/a', { name: '旧', searchText: '预计算 关键词', modified: new Date('2026-01-01') }),
    item('/b', { name: '新', searchText: '预计算 其他', modified: new Date('2026-10-01') }),
  ];
  assert.equal(sessions.selectSessions(prepared, { query: '关键词', sorted: true }).length, 1);
  assert.equal(sessions.selectSessions(prepared, { query: '旧', sorted: true }).length, 0);
  assert.deepEqual(sessions.selectSessions(prepared, { sorted: true }).map(s => s.path), ['/a', '/b']);
  assert.deepEqual(sessions.selectSessions(prepared).map(s => s.path), ['/b', '/a']);
});

test('用户消息含 null 或非文本块时仍提取文本并正常计数', async () => {
  await fixture(async file => {
    const path = await file('content', [header('content'),
      { type: 'message', message: { role: 'user',
        content: [null, { type: 'text', text: '有效消息' }, 'raw'] } }]);
    const evidence = await sessions.readEvidence(path);
    assert.equal(evidence.messageCount, 1);
    assert.equal(evidence.firstMessage, '有效消息');
  });
});

test('附件标题保留命名优先，支持 Windows/POSIX/引号路径并保留搜索原文', () => {
  const temp = item('/image.jsonl', { name: '', firstMessage: 'C:\\Temp\\pi-clipboard-ab12-34cd.png',
    modified: new Date(2026, 9, 22, 9, 5) });
  assert.equal(sessions.sessionTitle(temp), '[图片] 10/22 09:05');
  assert.equal(sessions.sessionTitle(temp, { image: 'Image' }), '[Image] 10/22 09:05');
  assert.match(sessions.sessionSearchText(temp, { image: 'Image' }), /^\[image\]/);
  assert.equal(sessions.sessionTitle({ ...temp, name: '自己的标题' }), '自己的标题');
  assert.equal(sessions.sessionTitle({ ...temp, firstMessage: '"/tmp/annual report.pdf"' }), '[附件] annual report.pdf');
  assert.equal(sessions.sessionTitle({ ...temp, firstMessage: '/tmp/design.png' }), '[图片] design.png');
  assert.equal(sessions.sessionTitle({ ...temp, firstMessage: '请检查 /tmp/design.png' }), '[图片] 请检查');
  assert.equal(sessions.selectSessions([temp], { query: 'ab12' }).length, 1);
});

test('图片开头后续有效请求与最近提问分别提取，首消息不被替换', async () => {
  await fixture(async file => {
    const opening = 'C:\\Temp\\pi-clipboard-ab12.png C:\\Temp\\pi-clipboard-cd34.png';
    const user = content => ({ type: 'message', message: { role: 'user', content } });
    const path = await file('context', [header('context'), named(opening), user(opening),
      user('飞书同步价格没有更新'),
      { type: 'message', message: { role: 'assistant', content: '不能使用这个回复作用户标题' } },
      user('/tmp/extra.pdf 已有订单受影响吗？'), user([{ type: 'image', data: 'secret' }]),
    ]);
    const evidence = await sessions.readEvidence(path);
    assert.equal(evidence.firstMessage, opening);
    assert.equal(evidence.firstRequest, '飞书同步价格没有更新');
    assert.equal(evidence.latestRequest, '已有订单受影响吗？');
    assert.equal(evidence.attachments.images, 2);
    assert.equal(sessions.sessionTitle({ path, ...evidence }), '[图片 ×2] 飞书同步价格没有更新');
    assert.doesNotMatch(JSON.stringify(evidence), /secret/);
  });
});

test('纯图片块开头仍保留附件类型，后续请求最多缓存600字', async () => {
  await fixture(async file => {
    const path = await file('image-block', [header('image-block'),
      { type: 'message', message: { role: 'user', content: [{ type: 'image', data: 'secret' }] } },
      { type: 'message', message: { role: 'user', content: '分析库存'.repeat(300) } },
    ]);
    const evidence = await sessions.readEvidence(path);
    assert.equal(evidence.firstMessage, '');
    assert.equal(evidence.attachments.images, 1);
    assert.equal(evidence.firstRequest.length, 600);
    assert.equal(evidence.latestRequest.length, 600);
  });
});

test('分类原因区分父记录不可读、调用不匹配、正常分支和核验成功，不改变隐藏规则', async () => {
  await fixture(async file => {
    const parent = await file('main', [header('main'), agent('abc12345-1234')]);
    const matching = await file('matching', [header('matching', parent), named('Explore#abc12345')]);
    const missing = await file('missing', [header('missing', '/missing/parent'), named('Explore#abc12345')]);
    const mismatch = await file('mismatch', [header('mismatch', parent), named('Explore#ffffffff')]);
    const branch = await file('branch', [header('branch', parent), named('普通分支')]);
    const result = await sessions.classifySessions([
      item(parent), item(matching, { parentSessionPath: parent }),
      item(missing, { parentSessionPath: '/missing/parent' }),
      item(mismatch, { parentSessionPath: parent }), item(branch, { parentSessionPath: parent }),
    ]);
    assert.deepEqual(result.map(s => s.classificationReason), ['noParent', 'verified', 'parentUnavailable', 'noMatchingCall', 'ordinaryBranch']);
    assert.deepEqual(result.filter(s => s.isSubagent).map(s => s.path), [matching]);
  });
});

test('取消分类立即中断，不把取消当作无法读取', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sessions.classifySessions([item('/missing')], { signal: controller.signal }), { name: 'AbortError' });
});
