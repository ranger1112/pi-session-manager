import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPicker } from '../src/picker.mjs';

class Input {
  focused = false; value = '';
  setValue(value) { this.value = value; }
  getValue() { return this.value; }
  handleInput(data) {
    // 测试用符号按键代表终端控制序列，不应作为搜索文本插入。
    if (['up', 'down', 'pageUp', 'pageDown', 'enter', 'escape'].includes(data)) return;
    this.value += data;
  }
  render() { return ['> ' + this.value]; }
  invalidate() {}
}
class SelectList {
  index = 0;
  constructor(items, maxVisible) { this.items = items; this.maxVisible = maxVisible; }
  setSelectedIndex(index) { this.index = index; }
  getSelectedItem() { return this.items[this.index] ?? null; }
  handleInput(data) {
    if (data === 'down') this.index = Math.min(this.items.length - 1, this.index + 1);
    if (data === 'up') this.index = Math.max(0, this.index - 1);
    this.onSelectionChange?.(this.getSelectedItem());
    if (data === 'enter' && this.getSelectedItem()) this.onSelect(this.getSelectedItem());
  }
  render() { return this.items.slice(0, this.maxVisible).map(i => i.label); }
  invalidate() {}
}
const primitives = { Input, SelectList, matchesKey: (data, key) => data === key,
  truncateToWidth: (text, width) => text.slice(0, width) };
const theme = { fg: (_, text) => text, bold: text => text };
const data = [
  { path: '/main', name: '主会话', cwd: '/p', modified: new Date(), messageCount: 2 },
  { path: '/child', name: 'Explore#abc12345', cwd: '/p', modified: new Date(), isSubagent: true },
];
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(load = async () => data, options = {}) {
  const finished = [];
  const picker = createPicker({ primitives, theme, requestRender() {}, done: v => finished.push(v), load, ...options });
  return { picker, finished };
}

test('默认只显示主会话，Ctrl+A 显示全部，Enter 返回准确路径', async () => {
  const { picker, finished } = setup();
  await flush();
  assert.match(picker.render(100).join('\n'), /已隐藏 1/);
  assert.doesNotMatch(picker.render(100).join('\n'), /Explore#/);
  picker.handleInput('ctrl+a');
  picker.handleInput('down');
  picker.handleInput('enter');
  assert.deepEqual(finished, ['/child']);
});

test('搜索保留主会话筛选，Esc 取消且焦点传给 Input', async () => {
  const { picker, finished } = setup();
  await flush();
  picker.focused = true;
  picker.handleInput('不存在');
  assert.match(picker.render(80).join('\n'), /没有匹配/);
  picker.handleInput('enter');
  assert.equal(finished.length, 0);
  picker.handleInput('escape');
  assert.deepEqual(finished, [undefined]);
});

test('切换范围加载时不能恢复旧记录，释放组件后停止加载', async () => {
  let calls = 0, aborted;
  const { picker, finished } = setup(async (_scope, signal) => {
    calls++;
    if (calls === 1) return data;
    aborted = signal;
    return new Promise(() => {});
  });
  await flush();
  picker.handleInput('tab');
  picker.handleInput('enter');
  assert.equal(finished.length, 0);
  assert.match(picker.render(40).join('\n'), /加载/);
  picker.dispose();
  assert.equal(aborted.aborted, true);
});

test('过期加载不能覆盖新范围，失败可用 Ctrl+R 重试', async () => {
  let firstResolve, count = 0;
  const { picker } = setup(async scope => {
    count++;
    if (count === 1) return new Promise(resolve => { firstResolve = resolve; });
    if (count === 2) throw new Error('拒绝读取');
    return data;
  });
  picker.handleInput('tab');
  await flush();
  assert.match(picker.render(100).join('\n'), /拒绝读取/);
  firstResolve(data);
  await flush();
  assert.match(picker.render(100).join('\n'), /拒绝读取/);
  picker.handleInput('ctrl+r');
  await flush();
  assert.match(picker.render(100).join('\n'), /主会话/);
});

const many = Array.from({ length: 20 }, (_, i) => ({ ...data[0], path: `/session-${i}`, name: `会话 ${i}` }));

test('分页按可见行数移动并限制在首尾，恢复正确路径', async () => {
  const { picker, finished } = setup(async () => many, { visibleRows: () => 4 });
  await flush();
  picker.handleInput('pageUp');
  picker.handleInput('pageDown');
  picker.handleInput('pageDown');
  picker.handleInput('pageUp');
  picker.handleInput('enter');
  assert.deepEqual(finished, ['/session-4']);
  const end = setup(async () => many, { visibleRows: () => 4 });
  await flush();
  for (let i = 0; i < 10; i++) end.picker.handleInput('pageDown');
  end.picker.handleInput('enter');
  assert.deepEqual(end.finished, ['/session-19']);
});

test('重绘时更新可见行数，保留选中项并使用新分页步长', async () => {
  let rows = 8;
  const { picker, finished } = setup(async () => many, { visibleRows: () => rows });
  await flush();
  picker.handleInput('down');
  assert.equal(picker.render(100).filter(line => /^会话 /.test(line)).length, 8);
  rows = 3;
  assert.equal(picker.render(100).filter(line => /^会话 /.test(line)).length, 3);
  picker.handleInput('pageDown');
  rows = 6;
  assert.equal(picker.render(100).filter(line => /^会话 /.test(line)).length, 6);
  picker.handleInput('enter');
  assert.deepEqual(finished, ['/session-4']);
});

test('使用自定义确认、分页和取消键，禁用默认绑定不回退', async () => {
  const bindings = { cancel: 'alt+x', confirm: 'alt+e', pageDown: 'alt+d', pageUp: 'alt+u' };
  const keybindings = { matches: (data, action) => data === bindings[action.replace('tui.select.', '')] };
  const { picker, finished } = setup(async () => many, { keybindings, visibleRows: () => 3 });
  await flush();
  picker.handleInput('pageDown');
  picker.handleInput('enter');
  assert.deepEqual(finished, []);
  picker.handleInput('alt+d');
  picker.handleInput('alt+d');
  picker.handleInput('alt+u');
  picker.handleInput('alt+e');
  assert.deepEqual(finished, ['/session-3']);
  const cancel = setup(async () => data, { keybindings });
  cancel.picker.handleInput('escape');
  assert.deepEqual(cancel.finished, []);
  cancel.picker.handleInput('alt+x');
  assert.deepEqual(cancel.finished, [undefined]);
});

test('打开时预选当前会话而非最新行，刷新后仍保留选中项', async () => {
  const ordered = [
    { path: '/new', name: '新会话', cwd: '/p', modified: new Date('2026-10-23'), messageCount: 1 },
    { path: '/old', name: '旧会话', cwd: '/p', modified: new Date('2026-01-01'), messageCount: 1 },
  ];
  const { picker, finished } = setup(async () => ordered, { currentPath: '/old' });
  await flush();
  assert.match(picker.render(100).join('\n'), /● 旧会话/);
  picker.handleInput('ctrl+r');
  await flush();
  assert.match(picker.render(100).join('\n'), /● 旧会话/);
  picker.handleInput('enter');
  assert.deepEqual(finished, ['/old']);
});

test('Windows 下当前会话标记忽略路径大小写', { skip: process.platform !== 'win32' }, async () => {
  const items = [{ path: 'C:\\Temp\\Session.jsonl', name: '当前会话', cwd: 'C:\\Temp',
    modified: new Date(), messageCount: 1 }];
  const { picker } = setup(async () => items, { currentPath: 'c:\\temp\\session.jsonl' });
  await flush();
  assert.match(picker.render(100).join('\n'), /● 当前会话/);
});

test('不可读警告加载完成后保留，重试清空，并忽略过期诊断', async () => {
  let count = 0, oldDiagnostics;
  const { picker } = setup(async (_scope, _signal, _progress, diagnostics) => {
    if (++count === 1) {
      oldDiagnostics = diagnostics;
      diagnostics({ unreadable: 2 });
    }
    return data;
  });
  await flush();
  assert.match(picker.render(100).join('\n'), /已跳过 2 个不可读会话文件/);
  picker.handleInput('不存在');
  assert.match(picker.render(100).join('\n'), /列表可能不完整/);
  picker.handleInput('ctrl+r');
  await flush();
  oldDiagnostics({ unreadable: 99 });
  assert.doesNotMatch(picker.render(100).join('\n'), /不可读/);
  picker.dispose();
});
