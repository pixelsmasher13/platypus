import type { Slide } from './slideDeck';

export type PresentationRequest = {
  plainText: string; provider: string; modelId: string; effort?: string; focus: string;
  slideCount: number; kind: 'designed' | 'simple'; sourceId?: number; sourceTitle: string;
};
export type SavedPresentation = {
  id: string; title: string; source_id?: number; source_title: string; created_at: string;
  kind: 'designed' | 'simple'; model: string; effort?: string; elapsed_seconds: number;
  slide_count: number; file_path?: string; slides?: Slide[];
};
export type PresentationJob = { id: string; request: PresentationRequest; status: 'running' | 'failed'; error?: string };

// Owned by the app, never by a note or modal. Each job captures its source and brief.
export class PresentationJobs {
  private jobs = new Map<string, PresentationJob>();
  private sequence = 0;
  constructor(private generate: (request: PresentationRequest) => Promise<SavedPresentation>, private events: {
    changed: (jobs: PresentationJob[]) => void;
    started: (job: PresentationJob) => void;
    completed: (job: PresentationJob, deck: SavedPresentation) => void;
    failed: (job: PresentationJob) => void;
  }) {}
  start(request: PresentationRequest): boolean {
    const source = request.sourceId ?? request.sourceTitle;
    if ([...this.jobs.values()].some(job => job.status === 'running' && (job.request.sourceId ?? job.request.sourceTitle) === source)) return false;
    const job: PresentationJob = { id: `presentation-${Date.now()}-${++this.sequence}`, request: { ...request }, status: 'running' };
    this.run(job);
    return true;
  }
  retry(id: string) {
    const job = this.jobs.get(id);
    if (job?.status === 'failed') {
      const source = job.request.sourceId ?? job.request.sourceTitle;
      if ([...this.jobs.values()].some(item => item.status === 'running' && (item.request.sourceId ?? item.request.sourceTitle) === source)) return;
      this.run({ ...job, status: 'running', error: undefined });
    }
  }
  dismiss(id: string) {
    if (this.jobs.get(id)?.status === 'failed') { this.jobs.delete(id); this.emit(); }
  }
  private emit() { this.events.changed([...this.jobs.values()]); }
  private run(job: PresentationJob) {
    this.jobs.set(job.id, job); this.emit(); this.events.started(job);
    void this.generate(job.request).then(deck => {
      this.jobs.delete(job.id); this.emit(); this.events.completed(job, deck);
    }, error => {
      const failed: PresentationJob = { ...job, status: 'failed', error: String(error) };
      this.jobs.set(job.id, failed); this.emit(); this.events.failed(failed);
    });
  }
}

export function mergePresentations(existing: SavedPresentation[], incoming: SavedPresentation[]) {
  const decks = new Map(existing.map(deck => [deck.id, deck]));
  incoming.forEach(deck => decks.set(deck.id, deck));
  return [...decks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
