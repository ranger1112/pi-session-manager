import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentContext, userMessageContext } from '../src/attachments.mjs';
import { sessionTitle, sessionSearchText } from '../src/sessions.mjs';

test('多附件路径和附带文字分离，重复路径不重复计数', () => {
  const text = 'C:\\Temp\\pi-clipboard-ab12.png C:\\Temp\\pi-clipboard-cd34.png\n飞书同步没有更新价格';
  const context = attachmentContext(text);
  assert.equal(context.text, '飞书同步没有更新价格');
  assert.equal(context.images, 2);
  assert.deepEqual(context.names, ['pi-clipboard-ab12.png', 'pi-clipboard-cd34.png']);
  assert.equal(attachmentContext('/tmp/a.png /tmp/a.png').images, 1);
  const quoted = attachmentContext('"C:\\My Files\\stock report.xlsx" 请检查库存');
  assert.equal(quoted.files, 1);
  assert.equal(quoted.text, '请检查库存');
  assert.equal(attachmentContext('https://example.com/a.png').text, 'https://example.com/a.png');
  assert.equal(attachmentContext('/tmp/not-an-attachment.mjs').text, '/tmp/not-an-attachment.mjs');
});

test('图片块与路径采用最大值避免重复，真实图片数据不保留', () => {
  const context = userMessageContext([{ type: 'text', text: '/tmp/a.png\n报错了' },
    { type: 'image', data: 'private-base64' }, null]);
  assert.equal(context.images, 1);
  assert.equal(context.text, '报错了');
  assert.doesNotMatch(JSON.stringify(context), /private-base64/);
  assert.equal(userMessageContext([{ type: 'image' }, { type: 'image' }]).images, 2);
});

test('路径名称不遮盖后续请求，普通名称不变，纯附件按名称数量时间兜底', () => {
  const item = { path: '/session.jsonl', name: '/tmp/a.png /tmp/b.png', firstMessage: '/tmp/a.png /tmp/b.png',
    firstRequest: '飞书同步出现异常', latestRequest: '已有订单会受影响吗',
    attachments: { images: 2, files: 0, names: ['a.png', 'b.png'] }, modified: new Date(2026, 9, 22, 9, 5) };
  assert.equal(sessionTitle(item), '[图片 ×2] 飞书同步出现异常');
  assert.equal(sessionTitle({ ...item, name: '保留我的名字' }), '保留我的名字');
  assert.equal(sessionTitle({ ...item, name: '', firstRequest: '' }), '[图片 ×2] a.png, b.png');
  assert.match(sessionSearchText(item), /已有订单会受影响吗/);
  assert.match(sessionSearchText(item), /\/tmp\/a.png/);
});
