import { cleanText, sessionTitle, sessionContext } from './sessions.mjs';
import { textFor } from './i18n.mjs';

export const projectName = path => cleanText(path).replace(/[/\\]+$/, '').split(/[/\\]/).at(-1);

const dateFormatters = new Map();
export function sessionDate(date, language = 'zh-CN') {
  if (!Number.isFinite(date?.getTime())) return '—';
  if (!dateFormatters.has(language)) dateFormatters.set(language, new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  return dateFormatters.get(language).format(date);
}

export function sessionDetails(item, language) {
  const t = textFor(language);
  const classification = item.classification ?? (item.isSubagent ? 'subagent' : 'user');
  const reason = t.reasons[item.classificationReason];
  const context = sessionContext(item), { images, files } = context.attachments;
  return [
    sessionTitle(item, t),
    `${t.preview}: ${cleanText(context.request) || t.noPreview}`,
    ...(context.latest && context.latest !== context.request ? [`${t.latest}: ${cleanText(context.latest)}`] : []),
    ...(images + files ? [`${t.attachment}: ${t.attachmentSummary(images, files)}`] : []),
    `${t.project}: ${cleanText(item.cwd) || t.unnamedProject}`,
    `${sessionDate(item.modified, language)} · ${t.messageCount(item.messageCount ?? 0)}`,
    `${t.details}: ${t.classes[classification]}${reason ? ` — ${reason}` : ''}`,
    ...(images + files && item.firstMessage ? [`${t.attachmentPaths}: ${cleanText(item.firstMessage)}`] : []),
    `${t.file}: ${cleanText(item.path)}`,
  ];
}
