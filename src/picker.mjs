import { cleanText, selectSessions, sessionTitle } from './sessions.mjs';

export function createPicker(options) {
  const { primitives: { Input, SelectList, matchesKey, truncateToWidth }, theme, done, load } = options;
  const input = new Input({ prompt: '搜索 > ' });
  let scope = options.scope ?? 'current', showAgents = options.showAgents ?? false;
  let items = [], list, selectedPath = options.currentPath;
  let loading = true, status = '', error = '', disposed = false, generation = 0;
  let controller;
  const renderAgain = () => { if (!disposed) options.requestRender(); };
  const rows = () => options.visibleRows?.() ?? 10;
  const rebuild = () => {
    const filtered = selectSessions(items, { query: input.getValue(), showAgents });
    list = new SelectList(filtered.map(item => ({
      value: item.path,
      label: `${item.path === options.currentPath ? '● ' : ''}${item.isSubagent ? '[Agent] ' : ''}${sessionTitle(item)}`,
      description: `${item.messageCount ?? 0} 条 · ${item.modified.toLocaleDateString()} · ${cleanText(item.cwd)}`,
    })), rows(), {
      selectedPrefix: text => theme.fg('accent', text),
      selectedText: text => theme.fg('accent', text),
      description: text => theme.fg('muted', text),
      scrollInfo: text => theme.fg('muted', text),
      noMatch: text => theme.fg('warning', text),
    });
    const index = filtered.findIndex(item => item.path === selectedPath);
    if (index >= 0) list.setSelectedIndex(index);
    list.onSelectionChange = item => { selectedPath = item.value; };
    list.onSelect = item => { if (!loading && !error) finish(item.value); };
    selectedPath = list.getSelectedItem()?.value;
  };
  const dispose = () => { disposed = true; controller?.abort(); };
  const finish = value => { dispose(); done(value); };
  const reload = async () => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal, token = ++generation;
    loading = true; status = ''; error = ''; items = []; rebuild(); renderAgain();
    try {
      const loaded = await load(scope, signal, text => {
        if (token !== generation || disposed) return;
        status = cleanText(text); renderAgain();
      });
      if (disposed || token !== generation) return;
      items = loaded; loading = false; rebuild(); renderAgain();
    } catch (cause) {
      if (disposed || token !== generation) return;
      loading = false;
      error = cleanText(cause instanceof Error ? cause.message : cause);
      renderAgain();
    }
  };
  const component = {
    get focused() { return input.focused; },
    set focused(value) { input.focused = value; },
    render(width) {
      const border = theme.fg('accent', '─'.repeat(Math.max(0, width)));
      const hidden = showAgents ? 0 : items.filter(item => item.isSubagent).length;
      const unknown = items.filter(item => item.classification === 'unknown').length;
      const title = `会话管理 · ${scope === 'current' ? '当前目录' : '所有目录'} · ${showAgents ? '全部会话' : '仅主会话'}`;
      const count = `${items.length} 个会话 · 已隐藏 ${hidden}${unknown ? ` · 未核验 ${unknown}（保留）` : ''}`;
      const lines = [border, theme.fg('accent', theme.bold(title)),
        theme.fg('muted', count), ...input.render(width), ''];
      if (loading) lines.push(theme.fg('muted', `加载中… ${status}`));
      else if (error) lines.push(theme.fg('error', `读取失败：${error}`));
      else if (!list?.getSelectedItem()) lines.push(theme.fg('muted', '没有匹配的会话'));
      else lines.push(...list.render(width));
      lines.push('', theme.fg('muted', 'Enter 恢复 · ↑↓ 选择 · Tab 目录范围'),
        theme.fg('muted', 'Ctrl+A 主会话/全部 · Ctrl+R 刷新 · Esc 关闭'), border);
      return lines.map(line => truncateToWidth(line, width));
    },
    handleInput(data) {
      if (disposed) return;
      if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) { finish(undefined); return; }
      if (matchesKey(data, 'tab')) {
        scope = scope === 'current' ? 'all' : 'current'; void reload(); return;
      }
      if (matchesKey(data, 'ctrl+r')) { void reload(); return; }
      if (matchesKey(data, 'ctrl+a')) { showAgents = !showAgents; rebuild(); renderAgain(); return; }
      if (loading || error) return;
      const navigation = ['up', 'down', 'pageUp', 'pageDown', 'enter'];
      if (navigation.some(key => matchesKey(data, key))) list?.handleInput(data);
      else {
        const previous = input.getValue(); input.handleInput(data);
        if (input.getValue() !== previous) rebuild();
      }
      renderAgain();
    },
    invalidate() { input.invalidate(); list?.invalidate(); rebuild(); },
    dispose,
  };
  void reload();
  return component;
}
