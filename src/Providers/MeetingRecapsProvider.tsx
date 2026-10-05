import { createContext, useCallback, useContext, useRef, useState, type PropsWithChildren } from 'react';
import { useToast } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { marked } from 'marked';
import { useNotify } from '../screens/ChatScreen/components/notifications';
import { GeneratedNoteModal } from '../screens/ChatScreen/components/GeneratedNoteModal';
import { MeetingRecapJobs, type GeneratedNoteDraft, type MeetingRecapJob, type MeetingRecapRequest } from '../screens/ChatScreen/meetingRecapJobs';
import { meetingNoteHtml } from '../screens/ChatScreen/meetingNoteContent';
import { enqueueNoteSave } from '../screens/ChatScreen/noteSaveQueue';
import { useProject } from '../state';

type ApplyToEditor = (request: MeetingRecapRequest, html: string, title: string, replace: boolean) => Promise<boolean>;
type Context = {
  jobs: MeetingRecapJob[];
  start: (request: MeetingRecapRequest) => boolean;
  review: (sourceId: number) => void;
  registerEditor: (id: number, apply: ApplyToEditor) => () => void;
};
const MeetingRecapsContext = createContext<Context | null>(null);
export function useMeetingRecaps() {
  const context = useContext(MeetingRecapsContext);
  if (!context) throw new Error('MeetingRecapsProvider is missing');
  return context;
}

export function MeetingRecapsProvider({ children }: PropsWithChildren) {
  const notify = useNotify();
  const toast = useToast();
  const project = useProject();
  const [jobs, setJobs] = useState<MeetingRecapJob[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const editors = useRef(new Map<number, ApplyToEditor>());
  const registerEditor = useCallback((id: number, apply: ApplyToEditor) => {
    editors.current.set(id, apply);
    return () => { if (editors.current.get(id) === apply) editors.current.delete(id); };
  }, []);
  const controller = useRef<MeetingRecapJobs>();
  const persist = async (draft: GeneratedNoteDraft, request: MeetingRecapRequest, replace = false) => {
    const html = meetingNoteHtml(await marked(draft.markdown), request);
    const apply = editors.current.get(request.sourceId);
    let saved: boolean;
    if (apply) saved = await apply(request, html, draft.title, replace);
    else {
      let expectedText = request.sourceHtml, expectedTitle = request.sourceTitle;
      if (replace) {
        const currentProject = project.getActivityProject(request.sourceId);
        if (!currentProject) throw new Error('The original meeting no longer exists.');
        expectedText = await invoke<string>('get_app_project_activity_text', { projectId: currentProject.id, activityId: request.sourceId });
        expectedTitle = project.getActivityName(request.sourceId);
      }
      saved = await enqueueNoteSave(request.sourceId, () => {
        // The note may have reopened while its final autosave was in flight.
        if (editors.current.has(request.sourceId)) return Promise.resolve(false);
        return invoke<boolean>('save_meeting_notes', { activityId: request.sourceId, expectedText, expectedTitle, text: html, title: draft.title });
      });
      if (saved) {
        const reopened = editors.current.get(request.sourceId);
        if (reopened) saved = await reopened(request, html, draft.title, false);
        else window.dispatchEvent(new CustomEvent('meeting-note-saved', { detail: { id: request.sourceId, html, title: draft.title } }));
      }
    }
    if (saved) {
      project.refreshProjects();
      invoke('vectorize_document_chunks', { documentId: request.sourceId }).catch(error => console.log('Indexing skipped:', error));
    }
    return saved;
  };
  const showStatus = (job: MeetingRecapJob) => {
    if (job.status === 'running') notify({ id: job.id, title: 'Creating your meeting notes', description: 'Keep working — we’ll let you know when they’re ready.', status: 'loading', duration: null });
    else if (job.status === 'saved') notify({ id: job.id, title: 'Meeting notes ready', description: job.draft?.title, status: 'success', duration: 8000, action: { label: 'Open meeting', onClick: () => project.selectActivity(job.request.sourceId) } });
    else if (job.status === 'ready') notify({ id: job.id, title: 'Your meeting notes are ready to review', description: 'You edited this note during generation. Review the result before replacing it.', status: 'success', duration: null, action: { label: 'Review notes', onClick: () => setActiveSourceId(job.request.sourceId) } });
    else notify({ id: job.id, title: "Couldn't finish the meeting notes", description: `${job.error} Your transcript is still saved.`, status: 'error', duration: null, action: { label: 'Retry', onClick: () => controller.current?.retry(job.request.sourceId) } });
  };
  // Jobs outlive the render that started them; use current navigation and editor bindings.
  const current = useRef({ persist, showStatus });
  current.current = { persist, showStatus };
  if (!controller.current) controller.current = new MeetingRecapJobs(
    request => invoke<string>('summarize_as_meeting_notes', { plainText: request.sources.notes, transcript: request.sources.transcript, provider: request.provider, modelId: request.modelId }),
    { changed: setJobs, started: job => current.current.showStatus(job), completed: job => current.current.showStatus(job), failed: job => current.current.showStatus(job) },
    (draft, request) => current.current.persist(draft, request),
  );
  const review = (sourceId: number) => {
    const job = controller.current!.get(sourceId);
    if (job?.status === 'ready') { toast.close(job.id); setActiveSourceId(sourceId); }
    else if (job?.status === 'failed') controller.current!.retry(sourceId);
    else if (job?.status === 'saved') project.selectActivity(sourceId);
    else if (job) showStatus(job);
  };
  const start = (request: MeetingRecapRequest) => {
    const accepted = controller.current!.start(request);
    if (!accepted) review(request.sourceId);
    return accepted;
  };
  const active = jobs.find(job => job.request.sourceId === activeSourceId);
  const discard = () => {
    if (active) { controller.current!.dismiss(active.request.sourceId); toast.close(active.id); }
    setActiveSourceId(null);
  };
  const save = async () => {
    if (!active?.draft) return;
    if (!await persist(active.draft, active.request, true)) throw new Error('The note changed again. Open it and review the latest edits before replacing it.');
    discard();
    notify({ title: 'Meeting notes saved', description: active.draft.title, status: 'success' });
  };
  return <MeetingRecapsContext.Provider value={{ jobs, start, review, registerEditor }}>
    {children}
    <GeneratedNoteModal key={active?.id || 'closed'} draft={active?.draft || null}
      onChange={draft => { if (active) controller.current!.update(active.request.sourceId, draft); }}
      onClose={() => setActiveSourceId(null)} onDiscard={discard} onSave={save} />
  </MeetingRecapsContext.Provider>;
}
