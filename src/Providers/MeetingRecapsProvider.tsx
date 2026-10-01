import { createContext, useContext, useRef, useState, type PropsWithChildren } from 'react';
import { useToast } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { marked } from 'marked';
import { useNotify } from '../screens/ChatScreen/components/notifications';
import { GeneratedNoteModal } from '../screens/ChatScreen/components/GeneratedNoteModal';
import { MeetingRecapJobs, type MeetingRecapJob, type MeetingRecapRequest } from '../screens/ChatScreen/meetingRecapJobs';
import { transcriptHtml } from '../screens/ChatScreen/meetingSources';
import { projectService } from '../data/project';
import { useProject } from '../state';

type Context = { jobs: MeetingRecapJob[]; start: (request: MeetingRecapRequest) => boolean; review: (sourceId: number) => void };
const MeetingRecapsContext = createContext<Context | null>(null);
export function useMeetingRecaps() {
  const context = useContext(MeetingRecapsContext);
  if (!context) throw new Error('MeetingRecapsProvider is missing');
  return context;
}

export function MeetingRecapsProvider({ children }: PropsWithChildren) {
  const notify = useNotify();
  const toast = useToast();
  const { refreshProjects } = useProject();
  const [jobs, setJobs] = useState<MeetingRecapJob[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const savedIds = useRef(new Map<string, number>());
  const controller = useRef<MeetingRecapJobs>();
  const showStatus = (job: MeetingRecapJob) => {
    if (job.status === 'running') notify({ id: job.id, title: 'Creating your meeting recap', description: `“${job.request.sourceTitle}” is cooking. Keep working — we'll let you know when it's ready.`, status: 'loading', duration: null });
    else if (job.status === 'ready') notify({ id: job.id, title: 'Your meeting recap is ready', description: `From “${job.request.sourceTitle}”. Review and save it when you're ready.`, status: 'success', duration: null, action: { label: 'Review recap', onClick: () => setActiveSourceId(job.request.sourceId) } });
    else notify({ id: job.id, title: "Couldn't create the meeting recap", description: job.error, status: 'error', duration: null, action: { label: 'Retry', onClick: () => controller.current?.retry(job.request.sourceId) } });
  };
  if (!controller.current) controller.current = new MeetingRecapJobs(
    request => invoke<string>('summarize_as_meeting_notes', { plainText: request.sources.notes, transcript: request.sources.transcript, provider: request.provider, modelId: request.modelId }),
    { changed: setJobs, started: showStatus, completed: showStatus, failed: showStatus },
  );
  const review = (sourceId: number) => {
    const job = controller.current!.get(sourceId);
    if (job?.status === 'ready') { toast.close(job.id); setActiveSourceId(sourceId); }
    else if (job?.status === 'failed') controller.current!.retry(sourceId);
    else if (job) showStatus(job);
  };
  const start = (request: MeetingRecapRequest) => {
    const accepted = controller.current!.start(request);
    if (!accepted) review(request.sourceId);
    return accepted;
  };
  const active = jobs.find(job => job.request.sourceId === activeSourceId);
  const discard = () => {
    if (active) { controller.current!.dismiss(active.request.sourceId); toast.close(active.id); savedIds.current.delete(active.id); }
    setActiveSourceId(null);
  };
  const save = async () => {
    if (!active?.draft) return;
    const draft = active.draft;
    const html = await marked(draft.markdown) + (draft.sources.transcript.trim() ? transcriptHtml(draft.sources.transcript) + '<p></p>' : '');
    let id = savedIds.current.get(active.id);
    if (id === undefined) {
      id = draft.projectId !== undefined ? await projectService.addBlankActivity(draft.projectId) : await projectService.addUnassignedActivity();
      savedIds.current.set(active.id, id);
    }
    await invoke('update_project_activity_text', { activityId: id, text: html });
    await projectService.updateActivityName(id, draft.title.trim());
    invoke('vectorize_document_chunks', { documentId: id }).catch(error => console.log('Indexing skipped:', error));
    refreshProjects();
    discard();
    notify({ title: 'Meeting recap saved', description: 'Saved as a separate note in the source project.', status: 'success' });
  };
  return <MeetingRecapsContext.Provider value={{ jobs, start, review }}>
    {children}
    <GeneratedNoteModal key={active?.id || 'closed'} draft={active?.draft || null}
      onChange={draft => { if (active) controller.current!.update(active.request.sourceId, draft); }}
      onClose={() => setActiveSourceId(null)} onDiscard={discard} onSave={save} />
  </MeetingRecapsContext.Provider>;
}
