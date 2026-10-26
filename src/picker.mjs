import { cleanText, selectSessions, sessionSearchText, sessionTitle } from './sessions.mjs';
import { pathsEqual } from './paths.mjs';
import { textFor } from './i18n.mjs';
import { projectName, sessionDate, sessionDetails } from './presentation.mjs';

export function createPicker(options) {
  const { primitives: { Input, SelectList, matchesKey, truncateToWidth }, theme, done, load } = options;
  const language = options.language ?? 'zh-CN', t = textFor(language);
  const input = new Input({ prompt: t.search });
  let scope = options.scope ?? 'current', showAgents = options.showAgents ?? false;
  let items = [], filtered = [], list, selectedPath = options.currentPath, listRows, listWidth = 80;
  let detailRows = 0, hidden = 0, unknown = 0;
  let loading = true, status = '', error = '', unreadable = 0, disposed = false, generation = 0;
  let controller;
  const renderAgain = () => { if (!disposed) options.requestRender(); };
  const rows = () => {
    const budget = options.visibleRows?.() ?? 12;
    detailRows = budget >= 12 ? Math.min(10, budget - 5) : budget >= 7 ? 3 : 0;
    return Math.max(1, budget - detailRows - (unreadable ? 1 : 0));
  };
  const selectionKey = (data, action, defaults) => options.keybindings
    ? options.keybindings.matches(data, `tui.select.${action}`)
    : defaults.some(key => matchesKey(data, key));
  const keyHint = (action, defaults) => (options.keybindings?.getKeys?.(`tui.select.${action}`) ?? defaults)
    .join('/') || t.unbound;
  // 标签、描述与搜索文本在加载时构造一次；按键/缩放只做过滤与重排。
  const decorate = item => ({
    ...item,
    searchText: sessionSearchText(item, t),
    label: `${pathsEqual(item.path, options.currentPath) ? '● ' : ''}${item.isSubagent ? '[Agent] ' : ''}${sessionTitle(item, t)}`,
    date: sessionDate(item.modified, language),
  });
  const rebuild = () => {
    filtered = selectSessions(items, { query: input.getValue(), showAgents, sorted: true });
    listRows = rows();
    list = new SelectList(filtered.map(item => ({
      value: item.path, label: item.label,
      description: listWidth < 64 ? undefined : scope === 'all'
        ? `${projectName(item.cwd) || t.unnamedProject} · ${item.date}` : item.date,
    })), listRows, {
      selectedPrefix: text => theme.fg('accent', text),
      selectedText: text => theme.fg('accent', text),
      description: text => theme.fg('muted', text),
      scrollInfo: text => theme.fg('muted', text),
      noMatch: text => theme.fg('warning', text),
    }, { minPrimaryColumnWidth: Math.max(1, Math.floor(listWidth * 0.6)),
      maxPrimaryColumnWidth: Math.max(1, Math.floor(listWidth * 0.6)) });
    const index = filtered.findIndex(item => pathsEqual(item.path, selectedPath));
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
    loading = true; status = ''; error = ''; unreadable = 0; hidden = 0; unknown = 0;
    items = []; rebuild(); renderAgain();
    try {
      const loaded = await load(scope, signal, text => {
        if (token !== generation || disposed) return;
        status = cleanText(text); renderAgain();
      }, diagnostics => {
        if (token !== generation || disposed) return;
        unreadable = diagnostics.unreadable;
      });
      if (disposed || token !== generation) return;
      items = loaded.map(decorate).sort((a, b) => b.modified.getTime() - a.modified.getTime());
      hidden = items.filter(item => item.isSubagent).length;
      unknown = items.filter(item => item.classification === 'unknown').length;
      loading = false; rebuild(); renderAgain();
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
      const widthChanged = listWidth !== width;
      listWidth = width;
      if (widthChanged || listRows !== rows()) rebuild();
      const border = theme.fg('accent', '─'.repeat(Math.max(0, width)));
      const title = `${t.title} · ${scope === 'current' ? t.current : t.all} · ${showAgents ? t.allSessions : t.hideAgents}`;
      const count = loading ? '—' : t.counts(filtered.length, items.length - (showAgents ? 0 : hidden),
        items.length, showAgents ? 0 : hidden, unknown, Boolean(input.getValue().trim()));
      const lines = [border, theme.fg('accent', theme.bold(title)),
        theme.fg('muted', count), ...input.render(width), ''];
      if (!loading && unreadable) lines.push(theme.fg('warning', t.unreadable(unreadable)));
      if (loading) lines.push(theme.fg('muted', `${t.loading} ${status}`));
      else if (error) lines.push(theme.fg('error', `${t.readError}: ${error}`));
      else if (!list?.getSelectedItem()) lines.push(theme.fg('muted', t.empty));
      else {
        lines.push(...list.render(width));
        const selected = filtered.find(item => pathsEqual(item.path, selectedPath));
        if (selected && detailRows) {
          const details = sessionDetails(selected, language);
          lines.push(theme.fg('muted', '─'.repeat(Math.max(0, width))));
          const shown = detailRows === 3
            ? [details[0], details.find(line => line.startsWith(`${t.details}:`))]
            : details.slice(0, detailRows - 1);
          lines.push(...shown.map((line, i) => theme.fg(i === 0 ? 'accent' : 'muted', line)));
        }
      }
      const confirm = keyHint('confirm', ['Enter']), cancel = keyHint('cancel', ['Esc']);
      const up = keyHint('up', ['↑']), down = keyHint('down', ['↓']);
      lines.push('', theme.fg('muted', `${confirm} ${t.resume} · ${up}/${down} ${t.choose} · Tab ${t.scope}`),
        theme.fg('muted', `Ctrl+A ${t.toggle} · Ctrl+R ${t.refresh} · ${cancel} ${t.close}`), border);
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
        const index = filtered.findIndex(item => pathsEqual(item.path, selectedPath));
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
