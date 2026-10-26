export const cleanText = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();

const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;
const extension = '\\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|txt|csv|docx?|xlsx?|pptx?|zip)';
const root = '(?:[a-z]:[/\\\\]|/|file://)';
// Quoted paths can contain spaces. Unquoted paths stop at whitespace; punctuation stays in the request.
const pathPattern = new RegExp(`(^|[\\s(])("${root}[^"\\r\\n]+?${extension}"|'${root}[^'\\r\\n]+?${extension}'|${root}[^\\s"'<>]+?${extension})(?=$|[\\s),;，。；])`, 'gim');

export function attachmentContext(text = '', imageBlocks = 0) {
  const names = [], paths = new Set();
  let images = 0, files = 0;
  const remainder = String(text).replace(pathPattern, (_match, boundary, raw) => {
    const path = raw.replace(/^["']|["']$/g, '');
    if (!paths.has(path)) {
      paths.add(path);
      const name = path.split(/[/\\]/).at(-1);
      if (names.length < 3) names.push(cleanText(name).slice(0, 160));
      if (imageExtension.test(name)) images++; else files++;
    }
    return boundary;
  });
  const meaningful = /^[\s,;，；()]*$/.test(remainder) ? '' : cleanText(remainder);
  return { text: meaningful, images: Math.max(images, imageBlocks), files, names };
}

export function userMessageContext(content) {
  const blocks = Array.isArray(content) ? content : [];
  const text = typeof content === 'string' ? content : blocks
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n');
  return { raw: text.slice(0, 600), ...attachmentContext(text,
    blocks.filter(block => block?.type === 'image').length) };
}
