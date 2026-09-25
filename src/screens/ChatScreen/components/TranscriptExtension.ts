import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TranscriptView } from './TranscriptView';

export const TranscriptExtension = Node.create({
  name: 'transcript',
  addOptions: () => ({ getNoteId: (): number | undefined => undefined }),
  addAttributes: () => ({ recordingId: {
    default: null,
    parseHTML: element => element.getAttribute('data-recording-id'),
    renderHTML: attributes => attributes.recordingId ? { 'data-recording-id': attributes.recordingId } : {},
  } }),
  addNodeView: () => ReactNodeViewRenderer(TranscriptView),
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'section[data-transcript]' }],
  renderHTML: ({ HTMLAttributes }) => ['section', mergeAttributes(HTMLAttributes, {
    'data-transcript': 'true', role: 'region', 'aria-label': 'Meeting transcript',
  }), 0],
});
