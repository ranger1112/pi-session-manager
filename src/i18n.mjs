export const messages = {
  'zh-CN': {
    search: '搜索 > ', title: '会话管理', current: '当前项目', all: '所有项目',
    allSessions: '全部会话', hideAgents: '隐藏已核验子 Agent',
    counts: (shown, visible, total, hidden, unknown, searching) => `${searching ? '匹配' : '显示'} ${shown} / 可见 ${visible} · 共 ${total} · 已隐藏 ${hidden}${unknown ? ` · 未核验 ${unknown}（保留）` : ''}`,
    unreadable: n => `已跳过 ${n} 个不可读会话文件或目录，列表可能不完整`,
    loading: '加载中…', readError: '读取失败', empty: '没有匹配的会话', unbound: '未绑定',
    resume: '恢复', choose: '选择', scope: '项目范围', toggle: '隐藏/全部', refresh: '刷新', close: '关闭',
    preview: '首条消息', project: '项目', details: '详情', file: '会话文件',
    image: '图片', attachment: '附件', noPreview: '无文本预览', unnamedProject: '未知项目',
    messageCount: n => `${n} 条`,
    classes: { user: '普通会话', subagent: '已核验子 Agent', unknown: '未核验（保留）' },
    reasons: {
      verified: '父会话 Agent 调用与初始名称匹配', noParent: '无父会话关联',
      ordinaryBranch: '初始名称不符合子 Agent 格式', noMatchingCall: '父会话中没有匹配的 Agent 调用',
      parentUnavailable: '父会话缺失或无法读取', childUnavailable: '无法读取子会话证据',
    },
    tuiOnly: '/sessions 需要交互式终端模式', busy: '请等待当前任务完成后再切换会话',
    restored: title => `已恢复：${title}`, cancelled: '会话切换已取消', restoreError: '无法恢复会话',
    command: '恢复会话（默认隐藏已核验子 Agent；支持 all、agents、lang）',
    languageSaved: mode => `界面语言已设为 ${mode}`, configError: '无法保存语言设置',
    languageUsage: '用法：/sessions lang zh-CN|en|auto',
    progress: (done, total, skipped) => `读取 ${done}/${total}${skipped ? ` · 跳过不可读 ${skipped}` : ''}`,
  },
  en: {
    search: 'Search > ', title: 'Sessions', current: 'Current project', all: 'All projects',
    allSessions: 'All sessions', hideAgents: 'Hide verified agents',
    counts: (shown, visible, total, hidden, unknown, searching) => `${searching ? 'Matches' : 'Showing'} ${shown} / ${visible} visible · ${total} total · ${hidden} hidden${unknown ? ` · ${unknown} unverified (kept)` : ''}`,
    unreadable: n => `Skipped ${n} unreadable files or directories; the list may be incomplete`,
    loading: 'Loading…', readError: 'Could not read sessions', empty: 'No matching sessions', unbound: 'Unbound',
    resume: 'resume', choose: 'select', scope: 'project scope', toggle: 'hidden/all', refresh: 'refresh', close: 'close',
    preview: 'First message', project: 'Project', details: 'Details', file: 'Session file',
    image: 'Image', attachment: 'Attachment', noPreview: 'No text preview', unnamedProject: 'Unknown project',
    messageCount: n => `${n} messages`,
    classes: { user: 'Regular session', subagent: 'Verified agent', unknown: 'Unverified (kept)' },
    reasons: {
      verified: 'Parent Agent call matches the initial name', noParent: 'No parent session',
      ordinaryBranch: 'Initial name does not match the agent format', noMatchingCall: 'No matching Agent call in the parent',
      parentUnavailable: 'Parent session is missing or unreadable', childUnavailable: 'Child evidence is unreadable',
    },
    tuiOnly: '/sessions requires interactive terminal mode', busy: 'Wait for the current task to finish before switching sessions',
    restored: title => `Resumed: ${title}`, cancelled: 'Session switch cancelled', restoreError: 'Could not resume session',
    command: 'Resume sessions (hide verified agents by default; supports all, agents, lang)',
    languageSaved: mode => `Interface language set to ${mode}`, configError: 'Could not save language settings',
    languageUsage: 'Usage: /sessions lang zh-CN|en|auto',
    progress: (done, total, skipped) => `Read ${done}/${total}${skipped ? ` · ${skipped} unreadable` : ''}`,
  },
};

export function resolveLanguage(mode = 'auto', env = process.env, systemLocale) {
  if (mode === 'zh-CN' || mode === 'en') return mode;
  const configured = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find(value => value?.trim());
  const locale = configured ?? systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return /^zh(?:[-_.]|$)/i.test(locale.trim()) ? 'zh-CN' : 'en';
}

export const textFor = (language = 'zh-CN') => messages[language] ?? messages.en;
