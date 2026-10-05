import { transcriptHtml } from './meetingSources';
import type { MeetingRecapRequest } from './meetingRecapJobs';

// Preserve speaker labels, timestamps and recording links, rather than flattening
// the transcript into a second note. Collapse is presentation only; all text stays.
export function savedTranscriptHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.querySelectorAll('section[data-transcript]')].map(section => {
    section.setAttribute('data-collapsed', 'true');
    return section.outerHTML;
  }).join('');
}
export function meetingNoteHtml(summaryHtml: string, request: MeetingRecapRequest): string {
  const transcript = request.transcriptHtml ?? transcriptHtml(request.sources.transcript);
  return summaryHtml + (request.sources.transcript.trim() ? savedTranscriptHtml(transcript) + '<p></p>' : '');
}
