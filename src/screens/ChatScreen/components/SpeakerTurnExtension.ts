import { Node, mergeAttributes } from '@tiptap/core';
import { sourceLabel, transcriptTime } from '../meetingSources';

export const SpeakerTurnExtension = Node.create({
  name: 'speakerTurn',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes: () => ({
    source: { default: 'microphone', parseHTML: element => element.getAttribute('data-source'), renderHTML: attrs => ({ 'data-source': attrs.source }) },
    label: { default: null, parseHTML: element => element.getAttribute('data-label'), renderHTML: attrs => ({ 'data-label': attrs.label || sourceLabel(attrs.source) }) },
    startMs: { default: 0, parseHTML: element => Number(element.getAttribute('data-start-ms')) || 0, renderHTML: attrs => ({ 'data-start-ms': attrs.startMs }) },
  }),
  parseHTML: () => [{ tag: 'div[data-transcript-turn]', contentElement: '[data-turn-content]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-transcript-turn': 'true' }),
    ['div', { 'data-turn-heading': 'true', contenteditable: 'false' },
      ['strong', {}, `${node.attrs.label || sourceLabel(node.attrs.source)}:`],
      ['span', { 'data-turn-time': 'true' }, ` ${transcriptTime(node.attrs.startMs)}`],
    ],
    ['div', { 'data-turn-content': 'true' }, 0],
  ],
  renderText: ({ node }) => `${node.attrs.label || sourceLabel(node.attrs.source)}: ${node.textContent}`,
});
