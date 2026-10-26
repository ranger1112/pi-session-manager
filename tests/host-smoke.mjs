// 宿主检查：默认使用项目安装的 Pi 包，也可传入本机 Pi 安装目录；只使用合成会话。
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createPicker } from '../src/picker.mjs';
import { textFor } from '../src/i18n.mjs';
import { readLanguage, saveLanguage } from '../src/preferences.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 宿主包是 ESM-only（exports 无 require 条件），用 import.meta.resolve 定位。
function packageRoot(name) {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  while (directory !== dirname(directory)) {
    if (existsSync(join(directory, 'package.json'))) return directory;
    directory = dirname(directory);
  }
  throw new Error(`找不到 ${name} 的安装目录`);
}

const hostArg = process.argv[2];
const host = hostArg ? resolve(hostArg) : packageRoot('@earendil-works/pi-coding-agent');
const fromHost = relative => import(pathToFileURL(join(host, relative)).href);
const { loadExtensions } = await fromHost('dist/core/extensions/loader.js');
// 手工安装目录把 pi-tui 放在宿主 node_modules 下；npm 安装时由解析器定位。
const nestedTui = join(host, 'node_modules/@earendil-works/pi-tui/dist/index.js');
const tuiEntry = hostArg && existsSync(nestedTui)
  ? nestedTui : fileURLToPath(import.meta.resolve('@earendil-works/pi-tui'));
const tui = await import(pathToFileURL(tuiEntry).href);
const { initTheme, getThemeByName } = await fromHost('dist/modes/interactive/theme/theme.js');
initTheme('dark', false);
const theme = getThemeByName('dark');
// 隔离语言偏好测试，不读取或修改个人配置。
const temporaryAgent = await mkdtemp(join(tmpdir(), 'pi-host-language-'));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = temporaryAgent;
try {
await saveLanguage(temporaryAgent, 'zh-CN');
const loaded = await loadExtensions([join(root, 'index.ts')], root);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
assert.deepEqual([...extension.commands.keys()], ['session-manager', 'sessions', 'resume-main']);
assert.equal(extension.commands.has('session'), false);
assert.equal(extension.commands.has('resume'), false);
const command = extension.commands.get('session-manager');
for (const name of ['sessions', 'resume-main']) {
  const alias = extension.commands.get(name);
  assert.equal(alias.handler, command.handler);
  assert.equal(alias.description, textFor('zh-CN').commandAlias);
}
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
for (const name of ['session-manager', 'sessions', 'resume-main']) {
  switched = undefined;
  await extension.commands.get(name).handler('all agents', ctx);
  assert.equal(switched, main.path, `${name} 应继续使用原会话切换路径`);
}
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
assert.equal(visibleRecords(), 6); // 五行列表加选中项标题
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
await command.handler('lang invalid', ctx);
assert.equal(notify.at(-1)[0], textFor('zh-CN').languageUsage);
assert.equal(await readLanguage(temporaryAgent), 'zh-CN');
await command.handler('lang en', ctx);
assert.ok(notify.some(([message]) => message.includes('Interface language set to en')));
await command.handler('', { ...ctx, mode: 'rpc' });
assert.equal(notify.at(-1)[0], textFor('en').tuiOnly);
for (const name of ['sessions', 'resume-main']) {
  await extension.commands.get(name).handler('lang zh-CN', ctx);
  assert.equal(await readLanguage(temporaryAgent), 'zh-CN');
  await extension.commands.get(name).handler('lang en', ctx);
  assert.equal(await readLanguage(temporaryAgent), 'en');
}
await command.handler('lang auto', ctx);
assert.equal(await readLanguage(temporaryAgent), 'auto');

const previews = [];
for (const language of ['zh-CN', 'en']) {
  const selections = [];
  picker = createPicker({ primitives: tui, theme, language, requestRender() {}, done: value => selections.push(value),
    visibleRows: () => 20, load: async () => [
      { ...main, name: '', firstMessage: 'C:\\Temp\\pi-clipboard-ab12.png',
        classification: 'unknown', classificationReason: 'parentUnavailable' },
      { ...main, path: '/example/other.jsonl', name: '用户命名 Keep my title', cwd: '/work/another-project' }, agent,
    ] });
  await flush();
  picker.focused = true;
  const text = picker.render(120).join('\n');
  assert.match(text, language === 'en' ? /Parent session is missing or unreadable/ : /父会话缺失或无法读取/);
  assert.match(text, language === 'en' ? /Showing 2 \/ 2 visible/ : /显示 2 \/ 可见 2/);
  assert.match(text, /11:58|\d{2}:\d{2}/);
  for (const width of [16, 40, 88, 120, 160]) {
    for (const line of picker.render(width)) assert.ok(tui.visibleWidth(line) <= width);
  }
  previews.push(`\n=== ${language} / current ===\n${picker.render(120).join('\n')}`);
  picker.handleInput('\u001b[B');
  assert.match(picker.render(120).join('\n'), /用户命名 Keep my title/);
  picker.handleInput('\t');
  await flush();
  const allView = picker.render(120).join('\n');
  assert.match(allView, /another-project/);
  previews.push(`\n=== ${language} / all ===\n${allView}`);
  picker.handleInput('\r');
  assert.deepEqual(selections, ['/example/other.jsonl']);
}
if (process.env.PI_SESSION_PREVIEW) writeFileSync(process.env.PI_SESSION_PREVIEW, previews.join('\n'));
console.log('PASS: Pi 原生加载、session-manager/兼容别名/语言设置、真实 TUI 双语/详情/分页/缩放/重绑键位/扫描警告');
} finally {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(temporaryAgent, { recursive: true, force: true });
}
