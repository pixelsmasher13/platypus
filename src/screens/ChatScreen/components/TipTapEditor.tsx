import { useRecordingOwner } from "../../../components/RecordingRecovery";
import { RecordingSourcePicker, RecordingMeters, defaultRecordingSource, type RecordingSource } from "../../../components/RecordingControls";
import { TranscriptExtension } from "./TranscriptExtension";
import { MeetingSourcesModal } from "./MeetingSourcesModal";
import { extractMeetingSources, transcriptNode, transcriptHtml, type MeetingSources } from "../meetingSources";
import { LiveTranscriptPreview, type LiveTranscriptUpdate } from "./LiveTranscriptPreview";
import { getConfiguredModel } from "../../../models/models";
import { type FC, useState, useEffect, useRef, useCallback } from "react";
import React from "react";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { closeHistory } from '@tiptap/pm/history';
import { PolishNoteModal, type PolishSource } from './PolishNoteModal';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Box,
  Button,
  Flex,
  Text,
  HStack,
  IconButton,
  Input,
  Tooltip,
  Select,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useToast,
  InputGroup,
  InputLeftElement,
  Spinner,
} from '@chakra-ui/react';
import { Bold, Italic, List, Undo, Redo, FolderInput, Search, Mic, Square, NotebookPen, Presentation, Wand2, Headphones, Mail } from "lucide-react";
import { SlideGeneratorModal } from "./SlideGeneratorModal";
import { usePresentations } from '../../../Providers/PresentationsProvider';
import { GeneratedNoteModal, type GeneratedNoteDraft } from "./GeneratedNoteModal";
import { EmailDraftModal } from "./EmailDraftModal";
import { PodcastGeneratorModal, type PodcastGenerationParams } from "./PodcastGeneratorModal";
import { PodcastPlayerModal, type PodcastResult } from "./PodcastPlayerModal";
import { useNotify } from "./notifications";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { useProject } from "../../../state";
import { projectService, UNASSIGNED_PROJECT_NAME } from "../../../data/project";
import { useGlobalSettings } from "../../../Providers/SettingsProvider";

type TipTapEditorProps = {
  content: string;
  title: string;
  documentId: number;
  onSave: (content: string, title: string, documentId: number) => void;
};

export const TipTapEditor: FC<TipTapEditorProps> = React.memo(({
  content,
  title,
  documentId,
  onSave,
}) => {
  const [hasChanges, setHasChanges] = useState(false);
  const [documentTitle, setDocumentTitle] = useState(title);
  const [currentFont, setCurrentFont] = useState('Inter');
  const [projectSearchTerm, setProjectSearchTerm] = useState("");
  const [polishSource, setPolishSource] = useState<PolishSource | null>(null);
  const isCleaningUp = !!polishSource;
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [meetingDraft, setMeetingDraft] = useState<GeneratedNoteDraft | null>(null);
  const [meetingSources, setMeetingSources] = useState<MeetingSources | null>(null);
  const meetingRequestRef = useRef(0);
  const recordingDocumentRef = useRef(documentId);
  const savedMeetingIdRef = useRef<number | null>(null);
  useEffect(() => () => { meetingRequestRef.current += 1; }, []);
  const [isDraftingEmail, setIsDraftingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  // Slide / podcast generator modal state — both share a fetched plain-text payload
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false);
  const [isPodcastModalOpen, setIsPodcastModalOpen] = useState(false);
  const [generatorPlainText, setGeneratorPlainText] = useState("");
  // Background podcast job + completed result for the player modal
  const [podcastResult, setPodcastResult] = useState<PodcastResult | null>(null);
  const [isPodcastPlayerOpen, setIsPodcastPlayerOpen] = useState(false);
  const [isPodcastJobRunning, setIsPodcastJobRunning] = useState(false);
  const [recordingSource, setRecordingSource] = useState<RecordingSource>(defaultRecordingSource);
  const recordingIdRef = useRef<string | null>(null);
  const recordingLocalRef = useRef(true);
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  useRecordingOwner(recordingIdRef.current, isRecording);
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingFilePath, setRecordingFilePath] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptUpdate | null>(null);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const recordingStartTimeRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptUnlistenRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    transcriptUnlistenRef.current?.();
  }, []);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const notify = useNotify();
  const presentations = usePresentations();
  const { settings } = useGlobalSettings();
  
  // Add ref for debouncing editor updates to prevent excessive re-renders
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Add ref to track last content to prevent unnecessary updates
  const lastContentRef = useRef<string>("");
  // Auto-save debounce ref
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest values for auto-save on unmount/navigation
  const latestContentRef = useRef<string>(content);
  const latestTitleRef = useRef<string>(title);
  const hasPendingSaveRef = useRef(false);
  const documentIdRef = useRef(documentId);
  
  const fonts = [
    { name: 'Inter', value: 'Inter' },
    { name: 'Arial', value: 'Arial, sans-serif' },
    { name: 'Times New Roman', value: 'Times New Roman, serif' },
    { name: 'Courier New', value: 'Courier New, monospace' },
    { name: 'Georgia', value: 'Georgia, serif' },
    { name: 'Verdana', value: 'Verdana, sans-serif' },
    { name: 'Roboto', value: 'Roboto, sans-serif' },
    { name: 'Open Sans', value: 'Open Sans, sans-serif' }
  ];
  
  // Get project-related data and functions
  const { 
    getVisibleProjects, 
    getActivityProject,
    moveActivity,
    refreshProjects
  } = useProject();
  
  // Check if the current document is in the Unassigned project
  const documentProject = getActivityProject(documentId);
  const isUnassignedDocument = documentProject?.name === UNASSIGNED_PROJECT_NAME;
  
  // Get all projects excluding Unassigned for the dropdown
  const availableProjects = getVisibleProjects();
  
  // Filter projects based on search term
  const filteredProjects = availableProjects.filter(project => 
    project.name.toLowerCase().includes(projectSearchTerm.toLowerCase())
  );
  
  // Perform the actual save
  const doAutoSave = useCallback(() => {
    if (!hasPendingSaveRef.current) return;
    onSave(latestContentRef.current, latestTitleRef.current, documentIdRef.current);
    hasPendingSaveRef.current = false;
    setHasChanges(false);
  }, [onSave]);

  // Schedule a debounced auto-save
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      doAutoSave();
    }, 1000);
  }, [doAutoSave]);

  // Debounced update handler to prevent excessive state updates
  const debouncedUpdateHandler = useCallback(({ editor }: { editor: any }) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      const currentHtml = editor.getHTML();
      const changed = currentHtml !== content || latestTitleRef.current !== title;
      setHasChanges(changed);

      // Undo may return to the original prop value while a newer save is pending.
      // Always replace the pending snapshot with the current editor contents.
      latestContentRef.current = currentHtml;
      hasPendingSaveRef.current = true;
      scheduleAutoSave();
    }, 250);
  }, [content, title, scheduleAutoSave]);
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      TranscriptExtension.configure({ getNoteId: () => documentIdRef.current }),
      TextStyle,
      FontFamily,
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: content,
    editable: true,
    onUpdate: debouncedUpdateHandler,
  });

  const hasMeetingTranscript = !!editor && !!extractMeetingSources(editor.getJSON()).transcript.trim();

  // Update editor content only when content actually changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      // Only update if the content has actually changed from what we last set
      if (content !== lastContentRef.current) {
        editor.commands.setContent(content);
        lastContentRef.current = content;
      }
    }
  }, [content, editor]);
  
  // Flush pending save on unmount only (NOT on doc switch — that's handled by documentId effect)
  useEffect(() => {
    const savedDocId = documentIdRef.current;
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      // Only flush if we're still on the same document (true unmount, not doc switch).
      // During doc switch, documentIdRef.current has already been updated by the
      // documentId effect, so savedDocId !== documentIdRef.current.
      if (hasPendingSaveRef.current && savedDocId === documentIdRef.current) {
        onSave(latestContentRef.current, latestTitleRef.current, savedDocId);
        hasPendingSaveRef.current = false;
      }
    };
  }, [onSave]);

  // When switching documents: cancel any pending saves for the OLD document
  // and reset refs to the NEW document's values.
  // IMPORTANT: We must NOT flush here — by this point state.selectedActivityId
  // already refers to the new doc, so flushing would save old data to the wrong doc.
  useEffect(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    setPolishSource(null);
    setMeetingSources(null);
    setMeetingDraft(null);
    setIsSummarizing(false);
    meetingRequestRef.current += 1;
    hasPendingSaveRef.current = false;
    documentIdRef.current = documentId;
    latestContentRef.current = content;
    latestTitleRef.current = title;
    // Reset editor content to the new document's content
    if (editor) {
      editor.commands.setContent(content);
      lastContentRef.current = content;
    }
  }, [documentId]);

  useEffect(() => {
    setDocumentTitle(title);
    latestTitleRef.current = title;
  }, [title]);

  // Opening a note from the library must keep keyboard navigation in the list.
  // Otherwise preserve the existing focus behavior for newly created notes.
  useEffect(() => {
    if (document.activeElement?.closest('[data-note-navigation]')) return;
    const timer = setTimeout(() => {
      if (document.activeElement?.closest('[data-note-navigation]')) return;
      if (!title) titleInputRef.current?.focus();
      else editor?.commands.focus('start');
    }, 50);
    return () => clearTimeout(timer);
  }, [documentId]);


  const handleTitleChange = (newTitle: string) => {
    setDocumentTitle(newTitle);
    latestTitleRef.current = newTitle;
    const changed = newTitle !== title || (editor ? editor.getHTML() !== content : false);
    setHasChanges(changed);
    if (changed) {
      if (editor) latestContentRef.current = editor.getHTML();
      hasPendingSaveRef.current = true;
      scheduleAutoSave();
    }
  };

  // --- Voice recording for current note ---
  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startNoteRecording = async () => {
    const useLocal = settings.use_local_transcription;

    if (!useLocal && !settings.api_key_open_ai) {
      toast({
        title: "API key required",
        description: "An OpenAI API key is needed for transcription. Add it in Settings.",
        status: "warning",
        duration: 5000,
        isClosable: true,
        position: "bottom-right",
      });
      return;
    }

    recordingDocumentRef.current = documentId;
    setIsPreparingRecording(true);

    try {
      // For local mode, ensure model is ready
      if (useLocal) {
        const modelReady = await invoke<boolean>('check_whisper_model');
        if (!modelReady) {
          setIsDownloadingModel(true);
          setDownloadProgress(0);
          const progressUnlisten = await listen<{ percent: number }>("model-download-progress", (event) => {
            setDownloadProgress(event.payload.percent);
          });
          try {
            await invoke('download_whisper_model');
          } finally {
            progressUnlisten();
            setIsDownloadingModel(false);
          }
        }
        await invoke('init_whisper_model');
      }

      setRecordingFilePath(null);
      setRecordingTime(0);
      setLiveTranscript(null);

      const result = await invoke<string>('start_audio_recording', { useLocal, noteId: recordingDocumentRef.current, source: recordingSource });
      recordingIdRef.current = result;
      recordingLocalRef.current = useLocal;
      if (!useLocal) {
        setRecordingFilePath(result);
      }

      // Listen for live transcript updates in local mode
      if (useLocal) {
        const unlisten = await listen<LiveTranscriptUpdate>("transcript-update", (event) => {
          setLiveTranscript(event.payload);
        });
        transcriptUnlistenRef.current = unlisten;
      }

      recordingStartTimeRef.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        if (recordingStartTimeRef.current) {
          setRecordingTime(Math.floor((Date.now() - recordingStartTimeRef.current) / 1000));
        }
      }, 1000);
      setIsRecording(true);
      setIsPreparingRecording(false);
    } catch (error) {
      console.error("Failed to start recording:", error);
      setIsPreparingRecording(false);
      toast({ title: "Recording failed", description: String(error), status: "error", duration: 3000, isClosable: true, position: "bottom-right" });
    }
  };

  const stopNoteRecording = async () => {
    const useLocal = recordingLocalRef.current;

    setIsRecording(false);
    setIsProcessingRecording(true);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    recordingStartTimeRef.current = null;

    // Cleanup transcript listener
    if (transcriptUnlistenRef.current) {
      transcriptUnlistenRef.current();
      transcriptUnlistenRef.current = null;
    }

    try {
      let transcription: string;

      if (useLocal) {
        transcription = await invoke<string>('stop_audio_recording', { useLocal: true });
        setIsProcessingRecording(false);
      } else {
        const filePath = await invoke<string>('stop_audio_recording', { useLocal: false });
        setRecordingFilePath(filePath);
        setIsProcessingRecording(false);

        setIsTranscribing(true);
        transcription = await invoke<string>('transcribe_audio', { filePath });
      }

      if (editor && transcription.trim()) {
        if (recordingDocumentRef.current !== documentIdRef.current) {
          // Keep a recording on its source note if navigation occurred during capture.
          await invoke('append_project_activity_text', { activityId: recordingDocumentRef.current, text: transcriptHtml(transcription, recordingIdRef.current) + '<p></p>' });
          invoke('vectorize_document_chunks', { documentId: recordingDocumentRef.current }).catch(() => {});
          toast({ title: "Transcript saved to the recorded note", status: "success" });
          return;
        }
        editor.commands.insertContentAt(editor.state.doc.content.size, [transcriptNode(transcription, recordingIdRef.current), { type: 'paragraph' }]);

        // Trigger auto-save
        latestContentRef.current = editor.getHTML();
        hasPendingSaveRef.current = true;
        scheduleAutoSave();
        setHasChanges(true);

        toast({ title: "Transcription added to note", status: "success", duration: 2000, isClosable: true, position: "bottom-right" });
      }
    } catch (error) {
      console.error("Recording/transcription failed:", error);
      toast({ title: "Transcription failed", description: String(error), status: "error", duration: 5000, isClosable: true, position: "bottom-right" });
    } finally {
      setIsTranscribing(false);
      setIsProcessingRecording(false);
      setRecordingFilePath(null);
      setRecordingTime(0);
      setLiveTranscript(null);
    }
  };

  const handleFontChange = (fontFamily: string) => {
    if (editor) {
      editor.chain().focus().setFontFamily(fontFamily).run();
      setCurrentFont(fontFamily);
    }
  };

  // Clear search when menu closes
  const handleMenuClose = () => {
    setProjectSearchTerm("");
  };

  // Handle project assignment/reassignment
  const handleAssignToProject = async (projectId: number) => {
    try {
      if (editor) {
        // Save any pending changes first
        onSave(editor.getHTML(), documentTitle, documentId);
        
        // Get the target project for the notification
        const targetProject = availableProjects.find(p => p.id === projectId);
        const actionWord = isUnassignedDocument ? "assigned to" : "moved to";
        
        // Use the moveActivity function from useProject hook
        const success = await moveActivity(documentId, projectId);
        
        if (success) {
          // Show success toast notification
          toast({
            title: isUnassignedDocument ? "Document Assigned" : "Document Moved",
            description: `Document ${actionWord} project "${targetProject?.name}"`,
            status: "success",
            duration: 3000,
            isClosable: true,
            position: "bottom-right"
          });
        } else {
          // Show error toast notification
          toast({
            title: "Error",
            description: "Failed to assign document to the selected project",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "bottom-right"
          });
        }
      }
    } catch (error) {
      console.error("Error assigning document to project:", error);
      toast({
        title: "Error",
        description: "Failed to assign document to the selected project",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-right"
      });
    }
  };

  // Determine provider and default model from settings
  const getProviderAndModel = () => ({
    provider: settings.api_choice,
    modelId: getConfiguredModel(settings),
  });

  const handleCleanUpWithAI = () => {
    if (!editor || isCleaningUp) return;
    if (hasMeetingTranscript) {
      setMeetingSources(extractMeetingSources(editor.getJSON()));
      return;
    }
    if (!editor.getText().trim()) {
      toast({ title: "Nothing to clean up", description: "Write or record a note first.", status: "info" });
      return;
    }
    // Snapshot the live rich text, including the latest unsaved edits and structure.
    setPolishSource({ documentId, html: editor.getHTML(), ...getProviderAndModel() });
  };

  const applyPolish = (html: string, source: PolishSource) => {
    if (!editor || documentIdRef.current !== source.documentId || editor.getHTML() !== source.html) {
      throw new Error("Your note changed while this draft was being made. Keep the original and clean it up again to include those edits.");
    }
    // Isolate replacement in history so one Undo restores the exact original.
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.chain().insertContentAt({ from: 0, to: editor.state.doc.content.size }, html).run();
    editor.view.dispatch(closeHistory(editor.state.tr));
    latestContentRef.current = editor.getHTML();
    hasPendingSaveRef.current = true;
    scheduleAutoSave();
    setHasChanges(true);
    setPolishSource(null);
    toast({ title: "Note cleaned up", description: "Use Undo to restore the original.", status: "success", duration: 2500 });
  };

  const closeMeetingDraft = () => {
    meetingRequestRef.current += 1;
    setMeetingDraft(null);
    setIsSummarizing(false);
    savedMeetingIdRef.current = null;
  };

  const handleSummarizeAsMeeting = () => {
    if (!editor || isSummarizing) return;
    setMeetingSources(extractMeetingSources(editor.getJSON()));
  };

  const enhanceMeeting = async (sources: MeetingSources) => {
    if (isSummarizing || (!sources.notes.trim() && !sources.transcript.trim())) return;
    setMeetingSources(null);
    const requestId = ++meetingRequestRef.current;
    const draft: GeneratedNoteDraft = {
      title: `${documentTitle || "Untitled"} — Meeting notes`,
      sourceTitle: documentTitle || "Untitled",
      projectId: documentProject?.id,
      markdown: "",
      sources,
    };
    savedMeetingIdRef.current = null;
    setMeetingDraft(draft);
    setIsSummarizing(true);
    try {
      const { provider, modelId } = getProviderAndModel();
      const markdown = await invoke<string>("summarize_as_meeting_notes", { plainText: sources.notes, transcript: sources.transcript, provider, modelId });
      if (meetingRequestRef.current !== requestId) return;
      if (!markdown.trim()) throw new Error("The model returned an empty draft. Please try again.");
      setMeetingDraft({ ...draft, markdown });
    } catch (error) {
      if (meetingRequestRef.current !== requestId) return;
      setMeetingDraft(null);
      setMeetingSources(sources);
      toast({ title: "Couldn't generate meeting notes", description: String(error), status: "error", isClosable: true });
    } finally {
      if (meetingRequestRef.current === requestId) setIsSummarizing(false);
    }
  };

  const saveMeetingDraft = async () => {
    if (!meetingDraft) return;
    const html = await marked(meetingDraft.markdown) + (meetingDraft.sources?.transcript.trim()
      ? transcriptHtml(meetingDraft.sources.transcript) + '<p></p>' : '');
    // Reuse a partially created note when retrying a failed save.
    if (savedMeetingIdRef.current === null) {
      savedMeetingIdRef.current = meetingDraft.projectId !== undefined
        ? await projectService.addBlankActivity(meetingDraft.projectId)
        : await projectService.addUnassignedActivity();
    }
    const id = savedMeetingIdRef.current;
    await invoke("update_project_activity_text", { activityId: id, text: html });
    await projectService.updateActivityName(id, meetingDraft.title.trim());
    invoke("vectorize_document_chunks", { documentId: id }).catch(error => console.log("Indexing skipped:", error));
    refreshProjects();
    closeMeetingDraft();
    toast({ title: "Meeting notes saved", description: "Saved as a separate note in the source project. Your original note is unchanged.", status: "success", isClosable: true });
  };

  const handleDraftFollowUpEmail = async () => {
    if (!editor) return;

    setIsDraftingEmail(true);
    try {
      const plainText = editor?.getText({ blockSeparator: "\n\n" }) || "";

      if (!plainText.trim()) {
        toast({
          title: "Nothing to draft from",
          description: "This note is empty. Write something first!",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-right",
        });
        return;
      }

      const { provider, modelId } = getProviderAndModel();
      const email = await invoke<string>("draft_follow_up_email", {
        plainText,
        provider,
        modelId,
      });

      if (email) {
        setEmailDraft(email);
        setIsEmailModalOpen(true);
      }
    } catch (error: any) {
      console.error("Follow-up email draft failed:", error);
      toast({
        title: "Couldn't draft the follow-up email",
        description: error?.toString() || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-right",
      });
    } finally {
      setIsDraftingEmail(false);
    }
  };

  const openGeneratorModal = async (kind: "slides" | "podcast") => {
    try {
      const plainText = editor?.getText({ blockSeparator: "\n\n" }) || "";

      if (!plainText.trim()) {
        toast({
          title: "Nothing to generate from",
          description: "This note is empty. Write something first!",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-right",
        });
        return;
      }

      setGeneratorPlainText(plainText);
      if (kind === "slides") setIsSlideModalOpen(true);
      else setIsPodcastModalOpen(true);
    } catch (error: any) {
      console.error("Failed to load document for generator:", error);
      toast({
        title: "Couldn't load document",
        description: error?.toString() || "An unexpected error occurred.",
        status: "error",
        duration: 4000,
        isClosable: true,
        position: "bottom-right",
      });
    }
  };

  const handleOpenSlideGenerator = () => openGeneratorModal("slides");
  const handleOpenPodcastGenerator = () => openGeneratorModal("podcast");

  // Fire-and-forget podcast generation. The modal closes immediately; we show a
  // soft notification while the backend works and another (with a "Listen" action) when it's done.
  const startPodcastJob = (params: PodcastGenerationParams) => {
    if (isPodcastJobRunning) {
      notify({
        title: "A podcast is already generating",
        description: "Wait for the current one to finish before starting another.",
        status: "info",
        duration: 3000,
      });
      return;
    }
    setIsPodcastJobRunning(true);
    notify({
      title: "Generating podcast",
      description: "We'll notify you when it's ready. Keep working — this takes 30-60 seconds.",
      status: "loading",
      duration: 5000,
    });

    invoke<PodcastResult>("generate_podcast_from_document", {
      plainText: params.plainText,
      provider: params.provider,
      modelId: params.modelId,
      focus: params.focus,
      lengthMinutes: params.lengthMinutes,
      voiceId: params.voiceId,
    })
      .then((res) => {
        setPodcastResult(res);
        notify({
          title: "Podcast ready",
          description: `${res.script_chars.toLocaleString()} characters of audio waiting.`,
          status: "success",
          duration: null,
          action: { label: "Listen", onClick: () => setIsPodcastPlayerOpen(true) },
        });
      })
      .catch((err: any) => {
        console.error("Podcast generation failed:", err);
        notify({
          title: "Podcast generation failed",
          description: err?.toString() || "An unexpected error occurred.",
          status: "error",
          duration: 8000,
        });
      })
      .finally(() => {
        setIsPodcastJobRunning(false);
      });
  };

  return (
    <Box width="100%" padding="var(--space-l)" maxWidth="900px" mx="auto">
          <Flex
            width="100%"
            justifyContent="space-between"
            alignItems="center"
            mb={4}
          >
            <Input
              ref={titleInputRef}
              value={documentTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Note title..."
              size="lg"
              fontWeight="bold"
              border="none"
              padding="0"
              _focus={{
                boxShadow: "none",
                borderBottom: "2px solid",
                borderColor: "teal.400",
                borderRadius: "0"
              }}
              maxWidth="80%"
            />
            
            <Flex alignItems="center" gap={2}>
              {/* Voice record into note */}
              <Tooltip label={isPreparingRecording ? "Preparing..." : isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Record into this note"}>
                <IconButton
                  aria-label={isRecording ? "Stop recording" : "Record voice note"}
                  icon={isPreparingRecording || isTranscribing ? <Spinner size="xs" /> : isRecording ? <Square size={16} /> : <Mic size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={isRecording ? stopNoteRecording : startNoteRecording}
                  color={isRecording ? "red.500" : undefined}
                  isDisabled={isPreparingRecording || isProcessingRecording || isTranscribing || isCleaningUp || isSummarizing}
                />
              </Tooltip>
              <RecordingSourcePicker value={recordingSource} onChange={setRecordingSource} disabled={isRecording || isPreparingRecording || isProcessingRecording || isTranscribing} />

              {/* Clean up or organize note */}
              <Tooltip label={hasMeetingTranscript ? "Organize meeting notes" : "Clean up note"}>
                <IconButton
                  aria-label={hasMeetingTranscript ? "Organize meeting notes" : "Clean up note"}
                  icon={isCleaningUp ? <Spinner size="xs" /> : <NotebookPen size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={handleCleanUpWithAI}
                  isDisabled={isCleaningUp || isSummarizing || isRecording || isTranscribing}
                />
              </Tooltip>

              {/* Generate dropdown: meeting notes, slides, podcast (coming soon) */}
              <Menu placement="bottom-end" isLazy>
                <Tooltip label="Generate from this note">
                  <MenuButton
                    as={IconButton}
                    aria-label="Generate from this note"
                    icon={isSummarizing || isDraftingEmail ? <Spinner size="xs" /> : <Wand2 size={16} />}
                    size="sm"
                    variant="ghost"
                    isDisabled={isCleaningUp || isSummarizing || isDraftingEmail || isRecording || isTranscribing}
                  />
                </Tooltip>
                <MenuList minWidth="220px">
                  <MenuItem
                    icon={<NotebookPen size={14} />}
                    onClick={handleSummarizeAsMeeting}
                  >
                    Organize meeting notes
                  </MenuItem>
                  <MenuItem
                    icon={<Mail size={14} />}
                    onClick={handleDraftFollowUpEmail}
                  >
                    Follow-up email
                  </MenuItem>
                  <MenuItem
                    icon={<Presentation size={14} />}
                    onClick={handleOpenSlideGenerator}
                  >
                    Slide deck
                  </MenuItem>
                  <MenuItem
                    icon={<Headphones size={14} />}
                    onClick={handleOpenPodcastGenerator}
                  >
                    Podcast
                  </MenuItem>
                  <MenuItem icon={<Presentation size={14} />} onClick={presentations.openLibrary}>Saved presentations</MenuItem>
                </MenuList>
              </Menu>

              {/* Project assignment/reassignment dropdown - show for all documents */}
              <Menu
                placement="bottom-end"
                isLazy
                onClose={handleMenuClose}
              >
                <Tooltip label={isUnassignedDocument ? "Assign to project" : `Move to another project (current: ${documentProject?.name})`}>
                  <MenuButton
                    as={IconButton}
                    aria-label={isUnassignedDocument ? "Assign to project" : "Move to project"}
                    icon={<FolderInput size={16} />}
                    size="sm"
                    variant="ghost"
                  />
                </Tooltip>
                <MenuList 
                  minWidth="240px" 
                  maxHeight="320px" 
                  overflow="auto"
                  padding={0}
                >
                  {/* Project search input - sticky at the top */}
                  <Box 
                    p={2} 
                    position="sticky" 
                    top="0" 
                    bg="white" 
                    zIndex={1}
                    borderBottomWidth="1px"
                    borderBottomColor="gray.100"
                  >
                    <InputGroup size="sm">
                      <InputLeftElement pointerEvents="none">
                        <Search size={14} color="var(--chakra-colors-gray-400)" />
                      </InputLeftElement>
                      <Input
                        placeholder={isUnassignedDocument ? "Search projects..." : "Move to project..."}
                        value={projectSearchTerm}
                        onChange={(e) => setProjectSearchTerm(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </InputGroup>
                  </Box>
                  
                  <Box p={1}>
                    {filteredProjects.length > 0 ? (
                      filteredProjects
                        .filter(p => p.id !== documentProject?.id) // Exclude current project
                        .map((project) => (
                          <MenuItem 
                            key={project.id}
                            onClick={() => handleAssignToProject(project.id)}
                            py={2}
                          >
                            {project.name}
                          </MenuItem>
                        ))
                    ) : (
                      <MenuItem isDisabled py={2}>
                        {projectSearchTerm ? "No matching projects" : "No other projects available"}
                      </MenuItem>
                    )}
                  </Box>
                </MenuList>
              </Menu>
              
            </Flex>
          </Flex>
            <HStack mb={4} spacing={2} alignItems="center" flexWrap="wrap">
              <IconButton
                aria-label="Bold"
                icon={<Bold size={16} />}
                onClick={() => editor?.chain().focus().toggleBold().run()}
                isActive={editor?.isActive('bold')}
                variant={editor?.isActive('bold') ? 'solid' : 'outline'}
                size="sm"
              />
              <IconButton
                aria-label="Italic"
                icon={<Italic size={16} />}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                isActive={editor?.isActive('italic')}
                variant={editor?.isActive('italic') ? 'solid' : 'outline'}
                size="sm"
              />
              <IconButton
                aria-label="Bullet List"
                icon={<List size={16} />}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                isActive={editor?.isActive('bulletList')}
                variant={editor?.isActive('bulletList') ? 'solid' : 'outline'}
                size="sm"
              />
              <IconButton
                aria-label="Undo"
                icon={<Undo size={16} />}
                onClick={() => editor?.chain().focus().undo().run()}
                isDisabled={!editor?.can().undo()}
                size="sm"
              />
              <IconButton
                aria-label="Redo"
                icon={<Redo size={16} />}
                onClick={() => editor?.chain().focus().redo().run()}
                isDisabled={!editor?.can().redo()}
                size="sm"
              />
              
              {/* Font Family Dropdown */}
              <Select 
                size="sm"
                value={currentFont}
                onChange={(e) => handleFontChange(e.target.value)}
                width="auto"
                ml={2}
              >
                {fonts.map((font) => (
                  <option 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: font.value }}
                  >
                    {font.name}
                  </option>
                ))}
              </Select>
            </HStack>

          <Box
            width="100%"
            sx={{
              ".ProseMirror": {
                outline: "none",
                width: "100%",
                maxWidth: "none",
                px: 3,
              },
              '.ProseMirror section[data-transcript]': {
                borderLeft: '3px solid', borderColor: 'teal.200', bg: 'gray.50',
                p: 4, my: 4, maxH: '320px', overflowY: 'auto',

              },
              ".ProseMirror ul, .ProseMirror ol": {
                paddingLeft: "1.5em",
              },
              ".ProseMirror p.is-editor-empty:first-of-type::before": {
                content: "attr(data-placeholder)",
                float: "left",
                color: "var(--chakra-colors-gray-400)",
                pointerEvents: "none",
                height: 0,
              },
              minH: "400px",
              py: 2,
              fontSize: "var(--font-size-m)",
              fontFamily: "var(--font-family-body)",
            }}
          >
            <EditorContent editor={editor} style={{ width: '100%' }} />
          </Box>

          {/* Model download progress */}
          {isDownloadingModel && (
            <Flex mt={3} px={3} py={2} bg="blue.50" borderRadius="md" align="center" gap={2}>
              <Spinner size="xs" color="blue.500" />
              <Text fontSize="xs" fontWeight="500" color="blue.600">
                Downloading model... {downloadProgress}%
              </Text>
            </Flex>
          )}

          {/* Inline recording status */}
          {(isPreparingRecording || isRecording || isTranscribing) && (
            <Box mt={3}>
              <Flex
                px={3} py={2}
                bg={isPreparingRecording ? "blue.50" : isRecording ? "red.50" : "teal.50"}
                borderRadius="md"
                align="center"
                gap={2}
              >
                {isPreparingRecording && !isRecording && (
                  <>
                    <Spinner size="xs" color="blue.500" />
                    <Text fontSize="xs" fontWeight="500" color="blue.600">
                      Connecting audio sources…
                    </Text>
                  </>
                )}
                {isRecording && (
                  <>
                    <Box
                      w="8px" h="8px" borderRadius="full" bg="red.500"
                      animation="pulse 1.5s ease-in-out infinite"
                      sx={{ '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }}
                    />
                    <Text fontSize="xs" fontWeight="500" color="red.600" flex={1}>
                      Recording {formatRecordingTime(recordingTime)}
                    </Text>
                    <Button size="xs" colorScheme="red" borderRadius="full" onClick={stopNoteRecording}>
                      Stop & Transcribe
                    </Button>
                  </>
                )}
                {isTranscribing && (
                  <>
                    <Spinner size="xs" color="teal.500" />
                    <Text fontSize="xs" fontWeight="500" color="teal.600">
                      Transcribing...
                    </Text>
                  </>
                )}
              </Flex>
              {isRecording && <RecordingMeters recordingId={recordingIdRef.current} source={recordingSource} />}
              {recordingLocalRef.current && isRecording && (
                <LiveTranscriptPreview update={liveTranscript} />
              )}
            </Box>
          )}

          <SlideGeneratorModal
            isOpen={isSlideModalOpen}
            onClose={() => setIsSlideModalOpen(false)}
            plainText={generatorPlainText}
            provider={getProviderAndModel().provider}
            modelId={getProviderAndModel().modelId}
            sourceId={documentId}
            sourceTitle={documentTitle}
            onGenerate={presentations.start}
          />
          <PodcastGeneratorModal
            isOpen={isPodcastModalOpen}
            onClose={() => setIsPodcastModalOpen(false)}
            plainText={generatorPlainText}
            provider={getProviderAndModel().provider}
            modelId={getProviderAndModel().modelId}
            onSubmit={startPodcastJob}
          />
          <PodcastPlayerModal
            isOpen={isPodcastPlayerOpen}
            onClose={() => setIsPodcastPlayerOpen(false)}
            result={podcastResult}
          />
          {polishSource && <PolishNoteModal
            key={polishSource.documentId}
            source={polishSource}
            onClose={() => setPolishSource(null)}
            onApply={applyPolish}
          />}
          {meetingSources && <MeetingSourcesModal
            initial={meetingSources}
            onClose={() => setMeetingSources(null)}
            onGenerate={sources => void enhanceMeeting(sources)}
          />}
          <GeneratedNoteModal
            draft={meetingDraft}
            isGenerating={isSummarizing}
            onChange={setMeetingDraft}
            onClose={closeMeetingDraft}
            onSave={saveMeetingDraft}
          />
          <EmailDraftModal
            isOpen={isEmailModalOpen}
            onClose={() => setIsEmailModalOpen(false)}
            emailText={emailDraft}
          />
    </Box>
  );
});
