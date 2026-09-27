// Transcript sections live in the note's HTML, so they survive saving, reopening,
// moving projects, and export without a second store getting out of sync.
export type NoteNode = { type?: string; attrs?: Record<string, unknown>; text?: string; content?: NoteNode[] };
export type TranscriptSegment = { source: 'microphone' | 'system'; start_ms: number; end_ms: number; text: string };
export const sourceLabel = (source: string) => source === 'system' ? 'Remote participants' : 'You';
export const transcriptTime = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export type MeetingSources = { notes: string; transcript: string };

function nodeText(node: NoteNode): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const children = node.content || [];
  const inline = children.every(child => child.type === 'text' || child.type === 'hardBreak');
  const text = children.map(nodeText).join(inline ? '' : '\n').trim();
  return node.type === 'speakerTurn' ? `${node.attrs?.label || sourceLabel(String(node.attrs?.source))}: ${text}` : text;
}

export function extractMeetingSources(document: NoteNode): MeetingSources {
  const notes: string[] = [];
  const transcripts: string[] = [];
  const visit = (node: NoteNode) => {
    if (node.type === 'transcript') { transcripts.push(nodeText(node)); return; }
    // Normally transcript sections are top-level, but keep pasted/nested sections separate too.
    if (node.content?.some(hasTranscript)) { node.content.forEach(visit); return; }
    notes.push(nodeText(node));
  };
  const hasTranscript = (node: NoteNode): boolean => node.type === 'transcript' || !!node.content?.some(hasTranscript);
  (document.content || []).forEach(visit);
  return { notes: notes.filter(Boolean).join('\n\n'), transcript: transcripts.filter(Boolean).join('\n\n') };
}

function paragraphs(text: string): NoteNode[] {
  return text.split(/\r?\n/).map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) }));
}
export function transcriptNode(text: string, recordingId?: string | null, segments: TranscriptSegment[] = []): NoteNode {
  return { type: 'transcript', ...(recordingId ? { attrs: { recordingId } } : {}), content: segments.length ? segments.map(segment => ({
    type: 'speakerTurn', attrs: { source: segment.source, label: sourceLabel(segment.source), startMs: segment.start_ms }, content: paragraphs(segment.text),
  })) : paragraphs(text) };
}

export function transcriptHtml(text: string, recordingId?: string | null, segments: TranscriptSegment[] = []): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paragraphHtml = (value: string) => value.split(/\r?\n/).map(line => `<p>${escape(line)}</p>`).join('');
  const content = segments.length ? segments.map(segment => `<div data-transcript-turn="true" data-source="${segment.source}" data-label="${sourceLabel(segment.source)}" data-start-ms="${segment.start_ms}"><div data-turn-heading="true" contenteditable="false"><strong>${sourceLabel(segment.source)}:</strong><span data-turn-time="true"> ${transcriptTime(segment.start_ms)}</span></div><div data-turn-content="true">${paragraphHtml(segment.text)}</div></div>`).join('') : paragraphHtml(text);
  return `<section data-transcript="true"${recordingId ? ` data-recording-id="${escape(recordingId)}"` : ''}>${content}</section>`;
}
