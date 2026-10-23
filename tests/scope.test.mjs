import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { sessionStorage } from '../src/scope.mjs';

test('自定义目录即使位于默认根目录下也不扩展到其他存储', () => {
  const agentDir = resolve('agent'), cwd = resolve('project');
  const shared = join(agentDir, 'sessions', 'shared');
  assert.deepEqual(sessionStorage({ agentDir, cwd, sessionDir: shared, scope: 'all' }), {
    directory: shared, recursive: false, cwd: undefined,
  });
});

test('精确匹配默认项目目录才允许所有目录扫描，当前范围保留 cwd 过滤', () => {
  const agentDir = resolve('agent'), cwd = resolve('project');
  const dir = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
  assert.deepEqual(sessionStorage({ agentDir, cwd, sessionDir: dir, scope: 'all' }), {
    directory: join(agentDir, 'sessions'), recursive: true, cwd: undefined,
  });
  assert.deepEqual(sessionStorage({ agentDir, cwd, sessionDir: dir, scope: 'current' }), {
    directory: dir, recursive: false, cwd,
  });
});
