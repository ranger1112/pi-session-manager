import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectName, sessionDate, sessionDetails } from '../src/presentation.mjs';

test('项目短名支持跨平台路径，日期含分钟且空时间可显示', () => {
  assert.equal(projectName('C:\\work\\inventory\\'), 'inventory');
  assert.equal(projectName('/work/inventory/'), 'inventory');
  assert.equal(sessionDate(new Date('invalid'), 'en'), '—');
  assert.match(sessionDate(new Date(2026, 9, 26, 14, 37), 'en'), /14:37/);
  assert.match(sessionDate(new Date(2026, 9, 26, 14, 37), 'zh-CN'), /14:37/);
});

test('详情显示分类原因与原文，清理控制字符而不修改输入对象', () => {
  const item = { path: '/sessions/main.jsonl', name: '用户标题', firstMessage: 'first\nmessage', cwd: '/work/project',
    modified: new Date(2026, 9, 26, 14, 37), messageCount: 8, classification: 'unknown', classificationReason: 'noMatchingCall' };
  const details = sessionDetails(item, 'en');
  assert.equal(details[0], '用户标题');
  assert.equal(details[1], 'First message: first message');
  assert.match(details[4], /No matching Agent call in the parent/);
  assert.equal(details[5], 'Session file: /sessions/main.jsonl');
  assert.equal(item.firstMessage, 'first\nmessage');
});
