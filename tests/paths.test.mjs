import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathsEqual } from '../src/paths.mjs';

test('路径比较先解析，缺失、空值与非字符串不视为相同', () => {
  assert.equal(pathsEqual('a/../b', resolve('b')), true);
  assert.equal(pathsEqual('', ''), false);
  assert.equal(pathsEqual(undefined, 'x'), false);
  assert.equal(pathsEqual(42, '42'), false);
});

test('Windows 下路径比较忽略大小写', { skip: process.platform !== 'win32' }, () => {
  assert.equal(pathsEqual('C:\\Temp\\A', 'c:\\temp\\a'), true);
});
