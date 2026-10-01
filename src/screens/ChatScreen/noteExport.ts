import type { JSONContent } from '@tiptap/core';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeMarkdown = (text: string) => text.replace(/&(?=(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, '&amp;').replace(/[\\`*_\[\]<>#~|]/g, '\\$&').replace(/^(\s*)([-+] )/gm, '$1\\$2').replace(/^(\s*\d+)([.)]) /gm, '$1\\$2 ');
const textOf = (node: JSONContent): string => node.type === 'hardBreak' ? '\n' : node.text ?? (node.content || []).map(textOf).join('');
const hasText = (node: JSONContent): boolean => !!textOf(node).trim();

export function withoutTranscripts(node: JSONContent): JSONContent | null {
  if (node.type === 'transcript') return null;
  if (!node.content) return node;
  const content = node.content.map(withoutTranscripts).filter((child): child is JSONContent => child !== null);
  if (node.type !== 'doc' && node.content.length && !content.length) return null;
  return { ...node, content };
}
export function noteExportOptions(document: JSONContent) {
  const hasTranscript = (node: JSONContent): boolean => node.type === 'transcript' || !!node.content?.some(hasTranscript);
  return { hasTranscript: hasTranscript(document), hasNotes: hasText(withoutTranscripts(document) || {}) };
}
function speakerLabel(node: JSONContent) {
  return String(node.attrs?.label || (node.attrs?.source === 'microphone' ? 'You' : 'Remote participants'));
}
function codeFence(text: string) {
  return '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
}
function markdown(node: JSONContent, plain = false): string {
  const children = node.content || [];
  const inline = () => children.map(child => markdown(child, plain)).join('');
  const blocks = () => children.map(child => markdown(child, plain)).filter(Boolean).join('\n\n');
  switch (node.type) {
    case 'text': {
      const text = node.text || '';
      if (plain) return text;
      if (node.marks?.some(mark => mark.type === 'code')) {
        const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
        const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
        return `${fence}${pad}${text}${pad}${fence}`;
      }
      let value = escapeMarkdown(text);
      for (const mark of node.marks || []) {
        if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'strike') {
          const delimiter = mark.type === 'bold' ? '**' : mark.type === 'italic' ? '*' : '~~';
          value = value.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, start, middle, end) => middle ? `${start}${delimiter}${middle}${delimiter}${end}` : value);
        }
      }
      return value;
    }
    case 'hardBreak': return plain ? '\n' : '  \n';
    case 'paragraph': return inline();
    case 'heading': return `${plain ? '' : '#'.repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 2))) + ' '}${inline()}`;
    case 'bulletList':
    case 'orderedList': return children.map((child, index) => {
      const prefix = node.type === 'orderedList' ? `${(Number(node.attrs?.start) || 1) + index}. ` : '- ';
      return markdown(child, plain).split('\n').map((line, i) => (i ? ' '.repeat(prefix.length) : prefix) + line).join('\n');
    }).join('\n');
    case 'listItem': return blocks();
    case 'blockquote': return blocks().split('\n').map(line => `> ${line}`).join('\n');
    case 'codeBlock': {
      const text = textOf(node);
      const fence = codeFence(text);
      return plain ? text : `${fence}${String(node.attrs?.language || '').replace(/[^\w+-]/g, '')}\n${text}\n${fence}`;
    }
    case 'horizontalRule': return '---';
    case 'transcript': return `${plain ? '' : '## '}Transcript\n\n${blocks()}`;
    case 'speakerTurn': return `${plain ? speakerLabel(node) : '**' + escapeMarkdown(speakerLabel(node)) + '**'}:\n${blocks()}`;
    default: return blocks();
  }
}
function html(node: JSONContent): string {
  const children = () => (node.content || []).map(html).join('');
  switch (node.type) {
    case 'text': {
      let value = escapeHtml(node.text || '');
      for (const mark of node.marks || []) {
        const tag = { bold: 'strong', italic: 'em', strike: 's', code: 'code' }[mark.type];
        if (tag) value = `<${tag}>${value}</${tag}>`;
      }
      return value;
    }
    case 'hardBreak': return '<br>';
    case 'paragraph': return `<p style="margin:0 0 10px">${children()}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
      return `<h${level} style="font-size:${[24, 20, 18, 16, 14, 14][level - 1]}px;font-weight:700;margin:18px 0 8px">${children()}</h${level}>`;
    }
    case 'bulletList': return `<ul style="padding-left:24px;margin:0 0 12px">${children()}</ul>`;
    case 'orderedList': return `<ol start="${Number(node.attrs?.start) || 1}" style="padding-left:24px;margin:0 0 12px">${children()}</ol>`;
    case 'listItem': return `<li>${children()}</li>`;
    case 'blockquote': return `<blockquote style="margin:12px 0;padding-left:16px;border-left:3px solid #ccc">${children()}</blockquote>`;
    case 'codeBlock': return `<pre><code>${escapeHtml(textOf(node))}</code></pre>`;
    case 'horizontalRule': return '<hr>';
    case 'transcript': return `<h2 style="font-size:20px;font-weight:700;margin:18px 0 8px">Transcript</h2>${children()}`;
    case 'speakerTurn': return `<p><strong>${escapeHtml(speakerLabel(node))}:</strong></p>${children()}`;
    default: return children();
  }
}
export function exportNote(title: string, document: JSONContent, includeTranscript = false) {
  const source = includeTranscript ? document : withoutTranscripts(document) || {};
  const name = title.trim() || 'Untitled note';
  const filename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 100).replace(/[. ]+$/, '') || 'Note';
  return {
    empty: !hasText(source),
    filename: `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ? '_' : ''}${filename}.md`,
    markdown: `# ${escapeMarkdown(name.replace(/\s*\n\s*/g, ' '))}\n\n${markdown(source).trim()}\n`,
    plainText: `${name}\n\n${markdown(source, true).trim()}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222"><h1 style="font-size:24px;font-weight:700;margin:0 0 16px">${escapeHtml(name)}</h1>${html(source)}</div>`,
  };
}
