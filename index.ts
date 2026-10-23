import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { Input, SelectList, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { resolve } from 'node:path';
import { cleanText, sessionTitle } from './src/sessions.mjs';
import { createPicker } from './src/picker.mjs';
import { createSessionStore } from './src/store.mjs';
import { sessionStorage } from './src/scope.mjs';

const store = createSessionStore();

const samePath = (a: string | undefined, b: string) => a && (
  process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
);

export async function browseSessions(args: string, ctx: ExtensionCommandContext) {
  if (ctx.mode !== 'tui') {
    ctx.ui.notify('/sessions 需要交互式终端模式', 'warning');
    return;
  }
  if (!ctx.isIdle()) {
    ctx.ui.notify('请等待当前任务完成后再切换会话', 'warning');
    return;
  }
  const currentPath = ctx.sessionManager.getSessionFile();
  const sessionDir = ctx.sessionManager.getSessionDir();
  const settings = new Set(args.trim().split(/\s+/));
  const target = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => createPicker({
    primitives: { Input, SelectList, matchesKey, truncateToWidth },
    theme, keybindings, requestRender: () => tui.requestRender(), done,
    scope: settings.has('all') ? 'all' : 'current',
    showAgents: settings.has('agents'), currentPath,
    visibleRows: () => Math.max(1, Math.min(12, (tui.terminal?.rows ?? 24) - 10)),
    load: async (scope: string, signal: AbortSignal, progress: (text: string) => void,
      diagnostics: (result: { unreadable: number }) => void) => {
      // 自定义 sessionDir 的“全部”只在该存储内搜索，不意外切回全局默认目录。
      return store.list({
        ...sessionStorage({ agentDir: getAgentDir(), cwd: ctx.cwd, sessionDir, scope }),
        signal, onProgress: progress, onDiagnostics: diagnostics,
      });
    },
  }));
  if (!target || samePath(currentPath, target)) return;
  try {
    const result = await ctx.switchSession(target, {
      withSession: async fresh => fresh.ui.notify(`已恢复：${sessionTitle({ path: target, name: fresh.sessionManager.getSessionName() })}`, 'info'),
    });
    if (result.cancelled) ctx.ui.notify('会话切换已取消', 'info');
  } catch (error) {
    ctx.ui.notify(`无法恢复会话：${cleanText(error instanceof Error ? error.message : error)}`, 'error');
  }
}

export default function sessionManager(pi: ExtensionAPI) {
  for (const name of ['sessions', 'resume-main']) {
    pi.registerCommand(name, {
      description: '恢复主会话（默认隐藏已核验的子 Agent；支持 all、agents）',
      handler: browseSessions,
    });
  }
}
