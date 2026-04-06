import { type FC, useState, useEffect, useRef, useCallback } from "react";
import React from "react";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
import { Bold, Italic, List, Undo, Redo, FolderInput, Search, Sparkles, Mic, Square, NotebookPen } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { useProject } from "../../../state";
import { UNASSIGNED_PROJECT_NAME } from "../../../data/project";
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
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingFilePath, setRecordingFilePath] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const recordingStartTimeRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptUnlistenRef = useRef<(() => void) | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
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
    moveActivity
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

      if (changed) {
        latestContentRef.current = currentHtml;
        hasPendingSaveRef.current = true;
        scheduleAutoSave();
      }
    }, 250);
  }, [content, title, scheduleAutoSave]);
  
  const editor = useEditor({
    extensions: [
      StarterKit,
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

  // Auto-focus: title for new blank notes, editor body for existing notes
  useEffect(() => {
    if (!title && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 50);
    } else if (editor) {
      setTimeout(() => editor.commands.focus('start'), 50);
    }
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
    setLiveTranscript("");

    try {
      const result = await invoke<string>('start_audio_recording', { useLocal });
      if (!useLocal) {
        setRecordingFilePath(result);
      }

      // Listen for live transcript updates in local mode
      if (useLocal) {
        const unlisten = await listen<{ text: string; is_final: boolean }>("transcript-update", (event) => {
          setLiveTranscript(event.payload.text);
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
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast({ title: "Recording failed", status: "error", duration: 3000, isClosable: true, position: "bottom-right" });
    }
  };

  const stopNoteRecording = async () => {
    const useLocal = settings.use_local_transcription;

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

      if (editor && transcription) {
        // Append transcript to the end of the note
        const separator = editor.getHTML() && editor.getHTML() !== '<p></p>'
          ? '<hr/><p><em>Voice note:</em></p>'
          : '<p><em>Voice note:</em></p>';
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, separator + `<p>${transcription}</p>`);

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
      setLiveTranscript("");
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
  const getProviderAndModel = (): { provider: string; modelId: string } => {
    switch (settings.api_choice) {
      case "claude": return { provider: "claude", modelId: settings.model_claude || "claude-sonnet-4-6" };
      case "openai": return { provider: "openai", modelId: settings.model_openai || "gpt-5.4" };
      case "gemini": return { provider: "gemini", modelId: settings.model_gemini || "gemini-3-pro-preview" };
      case "local": return { provider: "local", modelId: "llama3.3:70b" };
      default: return { provider: "claude", modelId: settings.model_claude || "claude-sonnet-4-6" };
    }
  };

  const handleCleanUpWithAI = async () => {
    if (!editor) return;

    setIsCleaningUp(true);
    try {
      // Fetch the stored plain_text from DB (already cleaned of HTML)
      const [, plainText] = await invoke<[string, string]>("get_app_project_activity_plain_text", {
        activityId: documentId,
      });

      if (!plainText.trim()) {
        toast({
          title: "Nothing to polish",
          description: "This note is empty. Write something first!",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-right",
        });
        return;
      }

      const { provider, modelId } = getProviderAndModel();
      const cleanedMarkdown = await invoke<string>("clean_up_document_with_llm", {
        plainText,
        provider,
        modelId,
      });

      if (cleanedMarkdown) {
        // Convert markdown to HTML for TipTap
        const html = await marked(cleanedMarkdown);
        editor.commands.setContent(html);

        // Trigger auto-save
        latestContentRef.current = editor.getHTML();
        hasPendingSaveRef.current = true;
        scheduleAutoSave();
        setHasChanges(true);

        toast({
          title: "Document polished",
          status: "success",
          duration: 2000,
          isClosable: true,
          position: "bottom-right",
        });
      }
    } catch (error: any) {
      console.error("Polish failed:", error);
      toast({
        title: "Couldn't polish this note",
        description: error?.toString() || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-right",
      });
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleSummarizeAsMeeting = async () => {
    if (!editor) return;

    setIsSummarizing(true);
    try {
      const [, plainText] = await invoke<[string, string]>("get_app_project_activity_plain_text", {
        activityId: documentId,
      });

      if (!plainText.trim()) {
        toast({
          title: "Nothing to summarize",
          description: "This note is empty. Write something first!",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-right",
        });
        return;
      }

      const { provider, modelId } = getProviderAndModel();
      const summaryMarkdown = await invoke<string>("summarize_as_meeting_notes", {
        plainText,
        provider,
        modelId,
      });

      if (summaryMarkdown) {
        const html = await marked(summaryMarkdown);
        editor.commands.setContent(html);

        latestContentRef.current = editor.getHTML();
        hasPendingSaveRef.current = true;
        scheduleAutoSave();
        setHasChanges(true);

        toast({
          title: "Meeting notes generated",
          status: "success",
          duration: 2000,
          isClosable: true,
          position: "bottom-right",
        });
      }
    } catch (error: any) {
      console.error("Meeting summary failed:", error);
      toast({
        title: "Couldn't summarize as meeting notes",
        description: error?.toString() || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-right",
      });
    } finally {
      setIsSummarizing(false);
    }
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
              <Tooltip label={isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Record into this note"}>
                <IconButton
                  aria-label={isRecording ? "Stop recording" : "Record voice note"}
                  icon={isTranscribing ? <Spinner size="xs" /> : isRecording ? <Square size={16} /> : <Mic size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={isRecording ? stopNoteRecording : startNoteRecording}
                  color={isRecording ? "red.500" : undefined}
                  isDisabled={isProcessingRecording || isTranscribing || isCleaningUp || isSummarizing}
                />
              </Tooltip>

              {/* Polish note button */}
              <Tooltip label="Polish & tidy up">
                <IconButton
                  aria-label="Polish note"
                  icon={isCleaningUp ? <Spinner size="xs" /> : <Sparkles size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={handleCleanUpWithAI}
                  isDisabled={isCleaningUp || isSummarizing || isRecording || isTranscribing}
                />
              </Tooltip>

              {/* Summarize as meeting notes button */}
              <Tooltip label="Summarize as meeting notes">
                <IconButton
                  aria-label="Summarize as meeting notes"
                  icon={isSummarizing ? <Spinner size="xs" /> : <NotebookPen size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={handleSummarizeAsMeeting}
                  isDisabled={isCleaningUp || isSummarizing || isRecording || isTranscribing}
                />
              </Tooltip>

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
          {(isRecording || isTranscribing) && (
            <Box mt={3}>
              <Flex
                px={3} py={2}
                bg={isRecording ? "red.50" : "teal.50"}
                borderRadius="md"
                align="center"
                gap={2}
              >
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
              {settings.use_local_transcription && liveTranscript && isRecording && (
                <Box mt={1} px={3} py={2} bg="gray.50" borderRadius="md" maxH="80px" overflowY="auto">
                  <Text fontSize="xs" color="gray.600" fontStyle="italic">
                    {liveTranscript}
                  </Text>
                </Box>
              )}
            </Box>
          )}
    </Box>
  );
});