import { Node, mergeAttributes } from '@tiptap/core';

export const TranscriptExtension = Node.create({
  name: 'transcript',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'section[data-transcript]' }],
  renderHTML: ({ HTMLAttributes }) => ['section', mergeAttributes(HTMLAttributes, {
    'data-transcript': 'true', role: 'region', 'aria-label': 'Meeting transcript',
  }), 0],
});
