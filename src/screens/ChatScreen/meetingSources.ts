// Transcript sections live in the note's HTML, so they survive saving, reopening,
// moving projects, and export without a second store getting out of sync.
export type NoteNode = { type?: string; attrs?: Record<string, unknown>; text?: string; content?: NoteNode[] };
export type MeetingSources = { notes: string; transcript: string };

function nodeText(node: NoteNode): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const children = node.content || [];
  const inline = children.every(child => child.type === 'text' || child.type === 'hardBreak');
  return children.map(nodeText).join(inline ? '' : '\n').trim();
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

export function transcriptNode(text: string, recordingId?: string | null): NoteNode {
  return { type: 'transcript', ...(recordingId ? { attrs: { recordingId } } : {}), content: text.split(/\r?\n/).map(line => ({
    type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}),
  })) };
}

export function transcriptHtml(text: string, recordingId?: string | null): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<section data-transcript="true"${recordingId ? ` data-recording-id="${escape(recordingId)}"` : ''}>${text.split(/\r?\n/).map(line => `<p>${escape(line)}</p>`).join('')}</section>`;
}
