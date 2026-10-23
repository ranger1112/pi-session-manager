import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPicker } from '../src/picker.mjs';

class Input {
  focused = false; value = '';
  setValue(value) { this.value = value; }
  getValue() { return this.value; }
  handleInput(data) { this.value += data; }
  render() { return ['> ' + this.value]; }
  invalidate() {}
}
class SelectList {
  index = 0;
  constructor(items) { this.items = items; }
  setSelectedIndex(index) { this.index = index; }
  getSelectedItem() { return this.items[this.index] ?? null; }
  handleInput(data) {
    if (data === 'down') this.index = Math.min(this.items.length - 1, this.index + 1);
    if (data === 'enter' && this.getSelectedItem()) this.onSelect(this.getSelectedItem());
  }
  render() { return this.items.map(i => i.label); }
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
function setup(load = async () => data) {
  const finished = [];
  const picker = createPicker({ primitives, theme, requestRender() {}, done: v => finished.push(v), load });
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
