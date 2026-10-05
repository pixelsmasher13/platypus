import type { MeetingSources } from './meetingSources';

export type GeneratedNoteDraft = { title: string; markdown: string; sourceTitle: string; projectId?: number; sources: MeetingSources };
export type MeetingRecapRequest = { sourceId: number; sourceTitle: string; sourceHtml: string; transcriptHtml?: string; projectId?: number; sources: MeetingSources; provider: string; modelId: string };
export type MeetingRecapJob = { id: string; request: MeetingRecapRequest; status: 'running' | 'ready' | 'saved' | 'failed'; draft?: GeneratedNoteDraft; error?: string };

export function temporaryMeetingTitle(date = new Date()): string {
  return `Meeting — ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
export function isAutomaticMeetingTitle(title: string): boolean {
  return !title.trim() || /^(?:untitled(?: note)?|new note|voice note(?:\s.*)?|meeting(?:\s*[—–-].*)?)$/i.test(title.trim());
}
export function parseMeetingNotes(output: string, sourceTitle: string) {
  const text = output.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  const heading = text.match(/^#\s+([^\n]+)(?:\n+|$)/);
  const clean = (title: string) => title.replace(/[*_`]/g, '').replace(/\s+#+$/, '').trim().slice(0, 120);
  const fallback = text.match(/^(?:#{2,3}\s+|\d+\.\s+\*\*|[-*]\s+\*\*)([^\n*]+)/m)?.[1];
  const title = isAutomaticMeetingTitle(sourceTitle)
    ? clean(heading?.[1] || fallback || temporaryMeetingTitle())
    : sourceTitle.trim();
  return { title, markdown: heading ? text.slice(heading[0].length).trim() : text };
}

// App-owned snapshots survive closing the editor and switching notes.
export class MeetingRecapJobs {
  private jobs = new Map<number, MeetingRecapJob>();
  private sequence = 0;
  constructor(private generate: (request: MeetingRecapRequest) => Promise<string>, private events: {
    changed: (jobs: MeetingRecapJob[]) => void;
    started: (job: MeetingRecapJob) => void;
    completed: (job: MeetingRecapJob) => void;
    failed: (job: MeetingRecapJob) => void;
  }, private save?: (draft: GeneratedNoteDraft, request: MeetingRecapRequest) => Promise<boolean>) {}
  get(sourceId: number) { return this.jobs.get(sourceId); }
  start(request: MeetingRecapRequest): boolean {
    const existing = this.get(request.sourceId);
    if (existing && existing.status !== 'saved') return false;
    this.run({ id: `meeting-recap-${Date.now()}-${++this.sequence}`, request: { ...request, sources: { ...request.sources } }, status: 'running' });
    return true;
  }
  retry(sourceId: number) {
    const job = this.get(sourceId);
    if (job?.status === 'failed') this.run({ ...job, status: 'running', error: undefined });
  }
  update(sourceId: number, draft: GeneratedNoteDraft) {
    const job = this.get(sourceId);
    if (job?.status === 'ready') {
      this.jobs.set(sourceId, { ...job, draft }); this.emit();
    }
  }
  dismiss(sourceId: number) {
    if (this.get(sourceId)?.status !== 'running') { this.jobs.delete(sourceId); this.emit(); }
  }
  private emit() { this.events.changed([...this.jobs.values()]); }
  private run(job: MeetingRecapJob) {
    this.jobs.set(job.request.sourceId, job); this.emit(); this.events.started(job);
    void (async () => {
      let draft = job.draft;
      try {
        if (!draft) {
          const parsed = parseMeetingNotes(await this.generate(job.request), job.request.sourceTitle);
          if (!parsed.markdown.trim()) throw new Error('The model returned an empty draft. Please try again.');
          draft = { ...parsed, sourceTitle: job.request.sourceTitle, projectId: job.request.projectId, sources: job.request.sources };
        }
        const saved = await this.save?.(draft, job.request);
        const ready: MeetingRecapJob = { ...job, status: saved ? 'saved' : 'ready', draft };
        this.jobs.set(job.request.sourceId, ready); this.emit(); this.events.completed(ready);
      } catch (error) {
        const failed: MeetingRecapJob = { ...job, draft, status: 'failed', error: String(error) };
        this.jobs.set(job.request.sourceId, failed); this.emit(); this.events.failed(failed);
      }
    })();
  }
}
