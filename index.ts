import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { Input, SelectList, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { cleanText, sessionTitle } from './src/sessions.mjs';
import { createPicker } from './src/picker.mjs';
import { createSessionStore } from './src/store.mjs';
import { sessionStorage } from './src/scope.mjs';
import { pathsEqual } from './src/paths.mjs';
import { textFor, resolveLanguage } from './src/i18n.mjs';
import { interfaceLanguage, languageModes, saveLanguage } from './src/preferences.mjs';

const store = createSessionStore();

export async function browseSessions(args: string, ctx: ExtensionCommandContext) {
  const agentDir = getAgentDir();
  let language = await interfaceLanguage(agentDir), t = textFor(language);
  const tokens = args.trim().split(/\s+/);
  if (tokens[0] === 'lang') {
    if (tokens.length !== 2 || !languageModes.includes(tokens[1])) {
      ctx.ui.notify(t.languageUsage, 'warning'); return;
    }
    try {
      await saveLanguage(agentDir, tokens[1]);
      language = resolveLanguage(tokens[1]); t = textFor(language);
      ctx.ui.notify(t.languageSaved(tokens[1]), 'info');
    } catch (error) {
      ctx.ui.notify(`${t.configError}: ${cleanText(error instanceof Error ? error.message : error)}`, 'error');
    }
    return;
  }
  if (ctx.mode !== 'tui') {
    ctx.ui.notify(t.tuiOnly, 'warning');
    return;
  }
  if (!ctx.isIdle()) {
    ctx.ui.notify(t.busy, 'warning');
    return;
  }
  const currentPath = ctx.sessionManager.getSessionFile();
  const sessionDir = ctx.sessionManager.getSessionDir();
  const settings = new Set(args.trim().split(/\s+/));
  const target = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => createPicker({
    primitives: { Input, SelectList, matchesKey, truncateToWidth },
    theme, language, keybindings, requestRender: () => tui.requestRender(), done,
    scope: settings.has('all') ? 'all' : 'current',
    showAgents: settings.has('agents'), currentPath,
    visibleRows: () => Math.max(1, Math.min(24, (tui.terminal?.rows ?? 24) - 10)),
    load: async (scope: string, signal: AbortSignal, progress: (text: string) => void,
      diagnostics: (result: { unreadable: number }) => void) => {
      // 自定义 sessionDir 的“全部”只在该存储内搜索，不意外切回全局默认目录。
      return store.list({
        ...sessionStorage({ agentDir, cwd: ctx.cwd, sessionDir, scope }),
        signal, onProgress: progress, onDiagnostics: diagnostics, progressText: t.progress,
      });
    },
  }));
  if (!target || pathsEqual(currentPath, target)) return;
  try {
    const result = await ctx.switchSession(target, {
      withSession: async fresh => fresh.ui.notify(t.restored(sessionTitle({ path: target, name: fresh.sessionManager.getSessionName() }, t)), 'info'),
    });
    if (result.cancelled) ctx.ui.notify(t.cancelled, 'info');
  } catch (error) {
    ctx.ui.notify(`${t.restoreError}: ${cleanText(error instanceof Error ? error.message : error)}`, 'error');
  }
}

export default async function sessionManager(pi: ExtensionAPI) {
  const t = textFor(await interfaceLanguage(getAgentDir()));
  for (const name of ['sessions', 'resume-main']) {
    pi.registerCommand(name, {
      description: t.command,
      handler: browseSessions,
    });
  }
}
