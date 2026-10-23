// 可选宿主检查：路径由调用者提供，只使用合成会话。
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createPicker } from '../src/picker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.argv[2];
assert.ok(host, '请提供 Pi 安装目录');
const fromHost = relative => import(pathToFileURL(join(host, relative)).href);
const { loadExtensions } = await fromHost('dist/core/extensions/loader.js');
const tui = await fromHost('node_modules/@earendil-works/pi-tui/dist/index.js');
const { initTheme, getThemeByName } = await fromHost('dist/modes/interactive/theme/theme.js');
initTheme('dark', false);
const theme = getThemeByName('dark');
const loaded = await loadExtensions([join(root, 'index.ts')], root);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
assert.deepEqual([...extension.commands.keys()].sort(), ['resume-main', 'sessions']);
const command = extension.commands.get('sessions');
let picker, switched, notify = [];
const main = { path: '/example/main.jsonl', cwd: '/example/project', name: '示例会话与中文输入',
  modified: new Date(), messageCount: 15 };
const agent = { ...main, path: '/example/child.jsonl', name: 'Explore#abc12345', isSubagent: true };
const ctx = {
  mode: 'tui', isIdle: () => true, cwd: root,
  sessionManager: { getSessionFile: () => '/current', getSessionDir: () => '/storage' },
  ui: {
    notify: (...args) => notify.push(args),
    custom: async () => main.path,
  },
  switchSession: async (target, { withSession }) => {
    switched = target;
    await withSession({ ui: { notify() {} }, sessionManager: { getSessionName: () => main.name } });
    return { cancelled: false };
  },
};
await command.handler('', ctx);
assert.equal(switched, main.path);
await command.handler('', { ...ctx, mode: 'rpc' });
assert.ok(notify.some(([message]) => message.includes('交互式')));
switched = undefined;
await command.handler('', { ...ctx, ui: { ...ctx.ui, custom: async () => undefined } });
assert.equal(switched, undefined);
let opened = false;
await command.handler('', { ...ctx, isIdle: () => false,
  ui: { ...ctx.ui, custom: async () => { opened = true; return main.path; } } });
assert.equal(opened, false);
assert.ok(notify.some(([message]) => message.includes('等待当前任务')));
await command.handler('', { ...ctx, switchSession: async () => ({ cancelled: true }) });
assert.ok(notify.some(([message]) => message.includes('切换已取消')));
await command.handler('', { ...ctx, switchSession: async () => { throw new Error('合成切换异常'); } });
assert.ok(notify.some(([message, level]) => level === 'error' && message.includes('合成切换异常')));

const results = [];
picker = createPicker({ primitives: tui, theme, requestRender() {}, done: v => results.push(v),
  load: async () => [main, agent] });
await new Promise(resolve => setImmediate(resolve));
picker.focused = true;
const rendered = picker.render(88);
for (const width of [16, 40, 88, 140]) {
  for (const line of picker.render(width)) assert.ok(tui.visibleWidth(line) <= width, `宽度溢出 ${width}`);
}
assert.equal(picker.focused, true);
assert.ok(rendered.some(line => line.includes(tui.CURSOR_MARKER)), '搜索框应提供 IME 光标标记');
picker.handleInput('\u0001'); // Ctrl+A
assert.match(picker.render(88).join('\n'), /Explore#/);
picker.handleInput('\u001b[B');
picker.handleInput('\r');
assert.deepEqual(results, [agent.path]);
const many = Array.from({ length: 20 }, (_, i) => ({ ...main, path: `/session-${i}`, name: `记录-${i}` }));
const flush = () => new Promise(resolve => setImmediate(resolve));
let rows = 6;
const paged = [];
picker = createPicker({ primitives: tui, theme, requestRender() {}, done: value => paged.push(value),
  visibleRows: () => rows, load: async () => many });
await flush();
const visibleRecords = () => picker.render(88).filter(line => /记录-\d+/.test(line)).length;
assert.equal(visibleRecords(), 6);
picker.handleInput('\u001b[6~'); // PageDown
rows = 3;
assert.equal(visibleRecords(), 3); // resize 不依赖 invalidate
picker.handleInput('\u001b[5~'); // PageUp: 6 -> 3
rows = 8;
assert.equal(visibleRecords(), 8);
picker.handleInput('\r');
assert.deepEqual(paged, ['/session-3']);

const previousBindings = tui.getKeybindings();
const keybindings = new tui.KeybindingsManager(tui.TUI_KEYBINDINGS, {
  'tui.select.up': 'alt+k', 'tui.select.down': 'alt+j',
  'tui.select.pageUp': 'alt+u', 'tui.select.pageDown': 'alt+d',
  'tui.select.confirm': 'alt+e', 'tui.select.cancel': 'alt+x',
});
try {
  tui.setKeybindings(keybindings);
  const selected = [];
  picker = createPicker({ primitives: tui, theme, keybindings, requestRender() {},
    done: value => selected.push(value), visibleRows: () => 3, load: async () => many });
  await flush();
  assert.match(picker.render(88).join('\n'), /alt\+e 恢复/);
  assert.match(picker.render(88).join('\n'), /alt\+x 关闭/);
  picker.handleInput('\u001b[6~'); // 默认分页键已解绑，不应进入搜索文本
  picker.handleInput('\u001b[B'); // 默认下键已解绑
  picker.handleInput('\u001bj'); // alt+j: 0 -> 1
  picker.handleInput('\u001bd'); // alt+d: 1 -> 4
  picker.handleInput('\u001bk'); // alt+k: 4 -> 3
  picker.handleInput('\u001bu'); // alt+u: 3 -> 0
  picker.handleInput('\u001bj'); // alt+j: 0 -> 1
  picker.handleInput('\r'); // 默认确认已解绑
  assert.deepEqual(selected, []);
  picker.handleInput('\u001be');
  assert.deepEqual(selected, ['/session-1']);
  const cancelled = [];
  picker = createPicker({ primitives: tui, theme, keybindings, requestRender() {},
    done: value => cancelled.push(value), load: async () => many });
  picker.handleInput('\u001bx');
  assert.deepEqual(cancelled, [undefined]);
} finally {
  picker.dispose();
  tui.setKeybindings(previousBindings);
}

picker = createPicker({ primitives: tui, theme, requestRender() {}, done() {},
  load: async (_scope, _signal, progress, diagnostics) => {
    progress('读取 2/2 · 跳过不可读 1');
    diagnostics({ unreadable: 1 });
    return [main];
  } });
await flush();
assert.match(picker.render(88).join('\n'), /已跳过 1 个不可读会话文件/);
assert.match(picker.render(88).join('\n'), /示例会话/);
for (const width of [16, 40, 88, 140]) {
  for (const line of picker.render(width)) assert.ok(tui.visibleWidth(line) <= width);
}
picker.dispose();
console.log('PASS: Pi 原生加载、命令保护/恢复/取消/异常、真实 TUI 输入/宽度/IME焦点/分页/缩放/重绑键位/扫描警告');
