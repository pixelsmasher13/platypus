import type { MeetingSources } from './meetingSources';

export type GeneratedNoteDraft = { title: string; markdown: string; sourceTitle: string; projectId?: number; sources: MeetingSources };
export type MeetingRecapRequest = { sourceId: number; sourceTitle: string; projectId?: number; sources: MeetingSources; provider: string; modelId: string };
export type MeetingRecapJob = { id: string; request: MeetingRecapRequest; status: 'running' | 'ready' | 'failed'; draft?: GeneratedNoteDraft; error?: string };

// App-owned snapshots survive closing the editor and switching notes.
export class MeetingRecapJobs {
  private jobs = new Map<number, MeetingRecapJob>();
  private sequence = 0;
  constructor(private generate: (request: MeetingRecapRequest) => Promise<string>, private events: {
    changed: (jobs: MeetingRecapJob[]) => void;
    started: (job: MeetingRecapJob) => void;
    completed: (job: MeetingRecapJob) => void;
    failed: (job: MeetingRecapJob) => void;
  }) {}
  get(sourceId: number) { return this.jobs.get(sourceId); }
  start(request: MeetingRecapRequest): boolean {
    if (this.jobs.has(request.sourceId)) return false;
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
      try {
        const markdown = await this.generate(job.request);
        if (!markdown.trim()) throw new Error('The model returned an empty draft. Please try again.');
        const ready: MeetingRecapJob = { ...job, status: 'ready', draft: {
          title: `${job.request.sourceTitle} — Meeting recap`, sourceTitle: job.request.sourceTitle,
          projectId: job.request.projectId, sources: job.request.sources, markdown,
        } };
        this.jobs.set(job.request.sourceId, ready); this.emit(); this.events.completed(ready);
      } catch (error) {
        const failed: MeetingRecapJob = { ...job, status: 'failed', error: String(error) };
        this.jobs.set(job.request.sourceId, failed); this.emit(); this.events.failed(failed);
      }
    })();
  }
}
