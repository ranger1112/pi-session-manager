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
console.log('PASS: Pi 原生加载、命令恢复/取消/RPC保护、真实 TUI 输入/宽度/IME焦点');
