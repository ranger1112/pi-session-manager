import { cleanText, selectSessions, sessionTitle } from './sessions.mjs';

export function createPicker(options) {
  const { primitives: { Input, SelectList, matchesKey, truncateToWidth }, theme, done, load } = options;
  const input = new Input({ prompt: '搜索 > ' });
  let scope = options.scope ?? 'current', showAgents = options.showAgents ?? false;
  let items = [], filtered = [], list, selectedPath = options.currentPath, listRows;
  let loading = true, status = '', error = '', unreadable = 0, disposed = false, generation = 0;
  let controller;
  const renderAgain = () => { if (!disposed) options.requestRender(); };
  const rows = () => Math.max(1, (options.visibleRows?.() ?? 10) - (unreadable ? 1 : 0));
  const selectionKey = (data, action, defaults) => options.keybindings
    ? options.keybindings.matches(data, `tui.select.${action}`)
    : defaults.some(key => matchesKey(data, key));
  const keyHint = (action, defaults) => (options.keybindings?.getKeys?.(`tui.select.${action}`) ?? defaults)
    .join('/') || '未绑定';
  const rebuild = () => {
    filtered = selectSessions(items, { query: input.getValue(), showAgents });
    listRows = rows();
    list = new SelectList(filtered.map(item => ({
      value: item.path,
      label: `${item.path === options.currentPath ? '● ' : ''}${item.isSubagent ? '[Agent] ' : ''}${sessionTitle(item)}`,
      description: `${item.messageCount ?? 0} 条 · ${item.modified.toLocaleDateString()} · ${cleanText(item.cwd)}`,
    })), listRows, {
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
    // 加载中的空列表不能清掉选中路径，否则加载完成后无法恢复到原选中项。
    const selected = list.getSelectedItem();
    if (selected) selectedPath = selected.value;
  };
  const dispose = () => { disposed = true; controller?.abort(); };
  const finish = value => { dispose(); done(value); };
  const reload = async () => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal, token = ++generation;
    loading = true; status = ''; error = ''; unreadable = 0; items = []; rebuild(); renderAgain();
    try {
      const loaded = await load(scope, signal, text => {
        if (token !== generation || disposed) return;
        status = cleanText(text); renderAgain();
      }, diagnostics => {
        if (token !== generation || disposed) return;
        unreadable = diagnostics.unreadable;
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
      if (listRows !== rows()) rebuild();
      const border = theme.fg('accent', '─'.repeat(Math.max(0, width)));
      const hidden = showAgents ? 0 : items.filter(item => item.isSubagent).length;
      const unknown = items.filter(item => item.classification === 'unknown').length;
      const title = `会话管理 · ${scope === 'current' ? '当前目录' : '所有目录'} · ${showAgents ? '全部会话' : '仅主会话'}`;
      const count = `${items.length} 个会话 · 已隐藏 ${hidden}${unknown ? ` · 未核验 ${unknown}（保留）` : ''}`;
      const lines = [border, theme.fg('accent', theme.bold(title)),
        theme.fg('muted', count), ...input.render(width), ''];
      if (!loading && unreadable) lines.push(theme.fg('warning', `已跳过 ${unreadable} 个不可读会话文件或目录，列表可能不完整`));
      if (loading) lines.push(theme.fg('muted', `加载中… ${status}`));
      else if (error) lines.push(theme.fg('error', `读取失败：${error}`));
      else if (!list?.getSelectedItem()) lines.push(theme.fg('muted', '没有匹配的会话'));
      else lines.push(...list.render(width));
      const confirm = keyHint('confirm', ['Enter']), cancel = keyHint('cancel', ['Esc']);
      const up = keyHint('up', ['↑']), down = keyHint('down', ['↓']);
      lines.push('', theme.fg('muted', `${confirm} 恢复 · ${up}/${down} 选择 · Tab 目录范围`),
        theme.fg('muted', `Ctrl+A 主会话/全部 · Ctrl+R 刷新 · ${cancel} 关闭`), border);
      return lines.map(line => truncateToWidth(line, width));
    },
    handleInput(data) {
      if (disposed) return;
      if (selectionKey(data, 'cancel', ['escape', 'ctrl+c'])) { finish(undefined); return; }
      if (matchesKey(data, 'tab')) {
        scope = scope === 'current' ? 'all' : 'current'; void reload(); return;
      }
      if (matchesKey(data, 'ctrl+r')) { void reload(); return; }
      if (matchesKey(data, 'ctrl+a')) { showAgents = !showAgents; rebuild(); renderAgain(); return; }
      if (loading || error) return;
      if (listRows !== rows()) rebuild();
      const pageUp = selectionKey(data, 'pageUp', ['pageUp']);
      const pageDown = selectionKey(data, 'pageDown', ['pageDown']);
      if (pageUp || pageDown) {
        const index = filtered.findIndex(item => item.path === selectedPath);
        if (index >= 0) {
          const next = Math.max(0, Math.min(filtered.length - 1, index + (pageUp ? -listRows : listRows)));
          list.setSelectedIndex(next);
          selectedPath = list.getSelectedItem()?.value;
        }
      } else if (selectionKey(data, 'confirm', ['enter'])) {
        const selected = list?.getSelectedItem();
        if (selected) finish(selected.value);
      } else if (selectionKey(data, 'up', ['up']) || selectionKey(data, 'down', ['down'])) {
        list?.handleInput(data);
      } else {
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
