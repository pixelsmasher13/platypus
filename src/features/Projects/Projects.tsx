import { type FC, useState, useMemo, useRef, useEffect } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/dialog";
import { 
  Box, 
  Menu, 
  MenuButton, 
  MenuList, 
  MenuItem, 
  IconButton, 
  Flex, 
  Badge,
  Tooltip,
  Divider,
  Input,
  InputGroup,
  InputLeftElement,
  Text as ChakraText,
  Tag,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  Button,
  useDisclosure,
  useToast,
  Spinner
} from "@chakra-ui/react";
import {
  Search,
  File,
  Trash2,
  Edit,
  X,
  MoreHorizontal,
  FilePlus,
  FileUp,
  FolderPlus,
  Mic,
  Square,
  ClipboardPaste,
} from 'lucide-react';
import { useGlobalSettings } from "../../Providers/SettingsProvider";
import { Text } from "@platypus-app/design";
import { useProject } from "../../state";
import { ProjectModal } from "@/components";
import { type Project } from "../../data/project";

//
// -- Styled Components --
const Container = styled(Box)`
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-l);
  gap: var(--space-l);
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  overflow: hidden;
  height: 100%;
`;

const StyledMenuButton = styled(MenuButton)`
  background-color: white;
  border: 1px solid var(--chakra-colors-gray-200);
  border-radius: var(--chakra-radii-md);
  padding: 8px 12px;
  height: 40px;
  display: flex;
  align-items: center;
  width: 100%;
  transition: all 0.2s;
  
  &:hover {
    background-color: var(--chakra-colors-gray-50);
    border-color: var(--chakra-colors-gray-300);
  }
  
  &:focus {
    box-shadow: 0 0 0 2px var(--chakra-colors-blue-100);
    border-color: var(--chakra-colors-blue-500);
  }
`;

const ScrollableMenuList = styled(MenuList)`
  max-height: 300px;
  overflow-y: auto;
  
  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 8px;
  }
  
  &::-webkit-scrollbar-track {
    background: var(--chakra-colors-gray-100);
    border-radius: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: var(--chakra-colors-gray-300);
    border-radius: 4px;
  }
  
  &::-webkit-scrollbar-thumb:hover {
    background: var(--chakra-colors-gray-400);
  }
`;

const DocumentsContainer = styled(Box)`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--chakra-radii-md);
  will-change: scroll-position;

  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--chakra-colors-gray-200);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--chakra-colors-gray-300);
  }
`;

const ProjectHeader = styled(Box)`
  background-color: var(--chakra-colors-gray-50);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--chakra-colors-gray-600);
  border-bottom: 1px solid var(--chakra-colors-gray-200);
`;

const DocumentName = styled(ChakraText)`
  font-size: 14px;
  line-height: 1.4;
  font-weight: 400;
  color: var(--chakra-colors-gray-800);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 40px; /* 2 lines * line height */
  max-width: calc(100% - 60px); /* Added more space for the three dots menu */
  padding-right: 4px; /* Extra padding to ensure separation */
`;

const ProjectTag = styled(Tag)`
  position: absolute;
  bottom: 8px;
  right: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background-color: var(--chakra-colors-gray-100);
  color: var(--chakra-colors-gray-600);
  z-index: 1;
`;

const UnassignedTag = styled(Tag)`
  position: absolute;
  bottom: 8px;
  right: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background-color: var(--chakra-colors-gray-100);
  color: var(--chakra-colors-gray-500);
  font-style: italic;
  z-index: 1;
`;

const SearchContainer = styled(Box)`
  margin-bottom: 10px;
`;

const truncateDocumentName = (name: string, maxLength: number = 30) => {
  if (name.length <= maxLength) return name;
  return `${name.substring(0, maxLength)}...`;
};

const UNASSIGNED_PROJECT_NAME = "Unassigned";

// DeleteProjectButton component for project deletion
const DeleteProjectButton: FC<{
  project: Project;
  onDelete: (project: Project) => void;
}> = ({ project, onDelete }) => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef(null);
  
  return (
    <>
      <Tooltip label="Delete this project">
        <IconButton
          aria-label="Delete project"
          icon={<Trash2 size={16} />}
          size="sm"
          variant="ghost"
          onClick={onOpen}
        />
      </Tooltip>
      
      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete Project
            </AlertDialogHeader>
            
            <AlertDialogBody>
              Are you sure you want to delete "{project.name}"? 
              This action cannot be undone.
            </AlertDialogBody>
            
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose}>
                Cancel
              </Button>
              <Button 
                colorScheme="red" 
                onClick={() => {
                  onDelete(project);
                  onClose();
                }} 
                ml={3}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

//
// -- Main Export --
export const Projects: FC<{
  selectedActivityId: number | null;
  onSelectActivity: (activityId: number | null) => void;
}> = ({ selectedActivityId, onSelectActivity }) => {
  const { 
    state, 
    selectProject, 
    addProject, 
    deleteProject, 
    updateProject,
    updateActivityName,
    addBlankActivity,
    addUnassignedActivity,
    deleteActivity,
    moveActivity,
    refreshProjects,
  } = useProject();
  
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<null | number>(null);

  const currentProject = useMemo(() => 
    state.projects.find(p => p.id === state.selectedProject),
    [state.projects, state.selectedProject]
  );

  // Filter out the unassigned project for the dropdown
  const visibleProjects = useMemo(() => 
    state.projects.filter(p => p.name !== UNASSIGNED_PROJECT_NAME),
    [state.projects]
  );

  const handleProjectSelect = (project: Project) => {
    selectProject(project.id);
  };

  const handleUnselectProject = () => {
    selectProject(undefined);
  };

  const handleNewProject = () => {
    setSelectedProjectId(null);
    setModalOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setSelectedProjectId(project.id);
    setModalOpen(true);
  };

  const handleDeleteProject = (project: Project) => {
    deleteProject(project.id);
    if (state.selectedProject === project.id) {
      selectProject(undefined);
    }
  };

  const handleClose = () => {
    setModalOpen(false);
    setSelectedProjectId(null);
  };

  const handleActivitySelect = (activityId: number) => {
    onSelectActivity(activityId);
  };

  return (
    <Container>
      <ProjectSelector
        projects={visibleProjects}
        allProjects={state.projects}
        selectedProject={currentProject}
        onSelectProject={handleProjectSelect}
        onUnselectProject={handleUnselectProject}
        onNewProject={handleNewProject}
        onEditProject={handleEditProject}
        onDeleteProject={handleDeleteProject}
        selectedActivityId={selectedActivityId}
        onSelectActivity={handleActivitySelect}
        onUpdateActivityName={updateActivityName}
        onAddBlankActivity={addBlankActivity}
        onAddUnassignedActivity={addUnassignedActivity}
        onDeleteActivity={deleteActivity}
        onRefreshProjects={refreshProjects}
      />
      
      <ProjectModal
        isOpen={modalOpen}
        projectId={selectedProjectId}
        onClose={handleClose}
        onUpdate={updateProject}
        onSave={addProject}
      />
    </Container>
  );
};

//
// -- ProjectSelector Component --
type ActivityDocument = {
  id: number;
  activity_id: number | null;
  name: string;
  projectId: number;
  projectName: string;
};

const ProjectSelector: FC<{
  projects: Project[];
  allProjects: Project[];
  selectedProject: Project | undefined;
  onSelectProject: (project: Project) => void;
  onUnselectProject: () => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  selectedActivityId: number | null;
  onSelectActivity: (activityId: number) => void;
  onUpdateActivityName: (activityId: number, name: string) => void;
  onAddBlankActivity: () => Promise<number | undefined>;
  onAddUnassignedActivity: () => Promise<number | undefined>;
  onDeleteActivity: (activityId: number) => void;
  onRefreshProjects: () => void;
}> = ({
  projects,
  allProjects,
  selectedProject,
  onSelectProject,
  onUnselectProject,
  onNewProject,
  onEditProject,
  onDeleteProject,
  selectedActivityId,
  onSelectActivity,
  onUpdateActivityName,
  onAddBlankActivity,
  onAddUnassignedActivity,
  onDeleteActivity,
  onRefreshProjects,
}) => {
  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [documentSearchTerm, setDocumentSearchTerm] = useState("");
  
  // Voice note recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [recordingFilePath, setRecordingFilePath] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const recordingStartTime = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptUnlistenRef = useRef<(() => void) | null>(null);
  
  const toast = useToast();
  const { settings } = useGlobalSettings();

  // Filter projects by name
  const filteredProjects = useMemo(() => {
    if (!searchTerm.trim()) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);

  // Build filtered + sorted document list (no pagination — render all at once)
  const sortedDocuments = useMemo(() => {
    const allDocs: ActivityDocument[] = selectedProject
      ? selectedProject.activities.map((_, index) => ({
          id: selectedProject.activities[index],
          activity_id: selectedProject.activity_ids[index],
          name: selectedProject.activity_names[index]
            || "Untitled Note",
          projectId: selectedProject.id,
          projectName: selectedProject.name,
        }))
      : allProjects.flatMap(project =>
          project.activities.map((_, index) => ({
            id: project.activities[index],
            activity_id: project.activity_ids[index],
            name: project.activity_names[index]
              || "Untitled Note",
            projectId: project.id,
            projectName: project.name,
          }))
        );

    const filtered = documentSearchTerm.trim()
      ? allDocs.filter(doc =>
          doc.name.toLowerCase().includes(documentSearchTerm.toLowerCase()) ||
          doc.projectName.toLowerCase().includes(documentSearchTerm.toLowerCase())
        )
      : allDocs;

    return filtered.sort((a, b) => b.id - a.id);
  }, [selectedProject, allProjects, documentSearchTerm]);

  // Start renaming a document
  const handleStartEdit = (activity: { id: number; name: string }) => {
    setEditingActivityId(activity.id);
    setEditingName(activity.name);
  };

  // Save document name change
  const handleSaveEdit = () => {
    if (editingActivityId && editingName.trim()) {
      onUpdateActivityName(editingActivityId, editingName.trim());
      setEditingActivityId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditingActivityId(null);
    }
  };

  // Create a new document in selected or unassigned project
  const handleAddNewDocument = async () => {
    let newActivityId;

    if (selectedProject) {
      newActivityId = await onAddBlankActivity();
    } else {
      newActivityId = await onAddUnassignedActivity();
    }

    if (newActivityId) {
      onSelectActivity(newActivityId);
    }
  };

  // Handle file import (PDF, DOCX, TXT, MD) - supports multiple files
  const handleFileImport = async () => {
    try {
      // Open file dialog to select files (multiple allowed)
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Documents',
          extensions: ['pdf', 'docx', 'txt', 'md', 'rtf']
        }]
      });

      if (!selected) return;

      // Normalize to array
      const filePaths = Array.isArray(selected) ? selected : [selected];
      if (filePaths.length === 0) return;

      // Show loading toast
      const loadingToast = toast({
        title: "Importing documents",
        description: `Processing ${filePaths.length} file${filePaths.length > 1 ? 's' : ''}...`,
        status: "info",
        duration: null,
        isClosable: false,
      });

      let successCount = 0;
      let lastActivityId: number | undefined;

      for (const filePath of filePaths) {
        try {
          // Extract text from file using Tauri command
          const extractedText = await invoke<string>('extract_document_text', {
            filePath
          });

          // Get filename without extension for the document title
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
          const documentName = fileName.includes('.')
            ? fileName.substring(0, fileName.lastIndexOf('.'))
            : fileName;

          // Create new activity
          let newActivityId;
          if (selectedProject) {
            newActivityId = await onAddBlankActivity();
          } else {
            newActivityId = await onAddUnassignedActivity();
          }

          if (newActivityId && extractedText) {
            // Update activity name and content
            await onUpdateActivityName(newActivityId, documentName);

            // Save the extracted text
            await invoke("update_project_activity_text", {
              activityId: newActivityId,
              text: extractedText
            });

            // Vectorize chunks (if enabled)
            invoke("vectorize_document_chunks", { documentId: newActivityId })
              .catch(e => console.log('Vectorization skipped:', e));

            lastActivityId = newActivityId;
            successCount++;
          }
        } catch (error) {
          console.error(`Error importing ${filePath}:`, error);
        }
      }

      // Close loading toast
      toast.close(loadingToast);

      if (successCount > 0) {
        // Select the last imported document
        if (lastActivityId) {
          onSelectActivity(lastActivityId);
        }

        toast({
          title: "Import successful",
          description: successCount === 1
            ? "1 document has been imported successfully."
            : `${successCount} documents have been imported successfully.`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Import failed",
          description: "Failed to import documents. Please try again.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error("Error selecting files:", error);
      toast({
        title: "File selection failed",
        description: "Could not open file dialog. Please try again.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Voice note helper: format recording time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start voice recording
  const startRecording = async () => {
    const useLocal = settings.use_local_transcription;

    try {
      // For OpenAI mode, check API key
      if (!useLocal && !settings.api_key_open_ai) {
        toast({
          title: "API key required",
          description: "An OpenAI API key is required for voice note transcription. Please add it in Settings.",
          status: "warning",
          duration: 5000,
          isClosable: true,
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

      // Reset audio state
      setRecordingFilePath(null);
      setRecordingTime(0);
      setLiveTranscript("");

      // Start recording via Tauri
      const result = await invoke<string>('start_audio_recording', { useLocal });
      if (!useLocal) {
        setRecordingFilePath(result);
      }
      console.log("Recording started, mode:", useLocal ? "local" : "openai");

      // Listen for live transcript updates in local mode
      if (useLocal) {
        const unlisten = await listen<{ text: string; is_final: boolean }>("transcript-update", (event) => {
          setLiveTranscript(event.payload.text);
        });
        transcriptUnlistenRef.current = unlisten;
      }

      // Start timer
      recordingStartTime.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        if (recordingStartTime.current) {
          const elapsedSeconds = Math.floor((Date.now() - recordingStartTime.current) / 1000);
          setRecordingTime(elapsedSeconds);
        }
      }, 1000);

      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Recording failed",
        description: "Could not start voice recording. Please try again.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Stop voice recording and auto-transcribe
  const stopRecording = async () => {
    const useLocal = settings.use_local_transcription;

    try {
      setIsProcessingRecording(true);
      setIsRecording(false);
      setIsTranscribing(true);

      // Stop timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingStartTime.current) {
        recordingStartTime.current = null;
      }

      // Cleanup transcript listener
      if (transcriptUnlistenRef.current) {
        transcriptUnlistenRef.current();
        transcriptUnlistenRef.current = null;
      }

      let transcription: string;

      if (useLocal) {
        // Local mode: stop returns the final transcript directly
        transcription = await invoke<string>('stop_audio_recording', { useLocal: true });
        setIsProcessingRecording(false);
      } else {
        // OpenAI mode: stop returns file path, then transcribe separately
        const filePath = await invoke<string>('stop_audio_recording', { useLocal: false });
        setRecordingFilePath(filePath);
        setIsProcessingRecording(false);
        console.log("Recording stopped, file path:", filePath);

        transcription = await invoke<string>('transcribe_audio', { filePath });
      }

      // Create a new activity with the transcription
      let newActivityId;
      if (selectedProject) {
        newActivityId = await onAddBlankActivity();
      } else {
        newActivityId = await onAddUnassignedActivity();
      }

      if (newActivityId) {
        const date = new Date();
        const documentName = `Voice Note ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

        // Update name and content in DB
        await invoke("update_project_activity_name", {
          activityId: newActivityId,
          name: documentName,
        });
        await invoke("update_project_activity_text", {
          activityId: newActivityId,
          text: transcription,
        });

        // Refresh state so sidebar shows the correct name
        onRefreshProjects();

        invoke("vectorize_document_chunks", { documentId: newActivityId })
          .catch(e => console.log('Vectorization skipped:', e));

        setRecordingFilePath(null);
        setRecordingTime(0);
        setLiveTranscript("");

        toast({
          title: "Transcription complete",
          description: "Voice note has been transcribed and saved successfully",
          status: "success",
          duration: 3000,
          isClosable: true,
        });

        onSelectActivity(newActivityId);
      }
    } catch (error) {
      console.error("Failed to record/transcribe:", error);
      toast({
        title: "Recording error",
        description: String(error).includes("API key")
          ? "OpenAI API key is required for audio transcription. Please add it in Settings."
          : "An error occurred. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsProcessingRecording(false);
      setIsTranscribing(false);
      setRecordingTime(0);
    }
  };

  // Listen for toggle_recording event (from system tray or meeting detection banner)
  useEffect(() => {
    const unlisten = listen("toggle_recording", () => {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [isRecording]);

  // Handle paste events to create new documents from clipboard content
  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault();
    
    // Check for image files in clipboard
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    
    // Handle pasted images
    if (imageItems.length > 0) {
      console.log(`Found ${imageItems.length} images in clipboard`);
      
      const imagePromises = imageItems.map(async (item) => {
        const file = item.getAsFile();
        if (!file) return null;
        
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(`<img src="${dataUrl}" alt="Pasted image" style="max-width: 100%;" />`);
          };
          reader.readAsDataURL(file);
        });
      });
      
      const imageHtmlArray = await Promise.all(imagePromises);
      const imagesHtml = imageHtmlArray.filter(Boolean).join('<br/>');
      
      if (imagesHtml) {
        let newActivityId;
        if (selectedProject) {
          newActivityId = await onAddBlankActivity();
        } else {
          newActivityId = await onAddUnassignedActivity();
        }
        
        if (newActivityId) {
          await onUpdateActivityName(newActivityId, 'Pasted Images');
          await invoke("update_project_activity_text", {
            activityId: newActivityId,
            text: imagesHtml
          });
          
          // Vectorize chunks (if enabled)
          invoke("vectorize_document_chunks", { documentId: newActivityId })
            .catch(e => console.log('Vectorization skipped:', e));
          
          onSelectActivity(newActivityId);
          
          toast({
            title: "Images pasted",
            description: "Images have been saved to a new document",
            status: "success",
            duration: 2000,
            isClosable: true,
          });
        }
        return;
      }
    }
    
    // Try to get HTML content first, fall back to plain text
    let content = e.clipboardData.getData('text/html');
    const isHtml = !!content.trim();
    
    if (!isHtml) {
      content = e.clipboardData.getData('text');
    }
    
    const plainText = e.clipboardData.getData('text');
    
    if (content.trim()) {
      console.log('Paste event detected, isHtml:', isHtml);
      
      try {
        let newActivityId;
        if (selectedProject) {
          newActivityId = await onAddBlankActivity();
        } else {
          newActivityId = await onAddUnassignedActivity();
        }
        
        if (newActivityId) {
          // Generate document name from first line of plain text
          const firstLine = plainText.split('\n')[0].trim();
          const documentName = firstLine.length > 50 
            ? firstLine.substring(0, 47) + '...' 
            : firstLine || 'Pasted Document';
          
          await onUpdateActivityName(newActivityId, documentName);
          await invoke("update_project_activity_text", {
            activityId: newActivityId,
            text: content
          });
          
          // Vectorize chunks (if enabled)
          invoke("vectorize_document_chunks", { documentId: newActivityId })
            .catch(e => console.log('Vectorization skipped:', e));
          
          onSelectActivity(newActivityId);
          
          toast({
            title: "Content pasted",
            description: "Content has been saved to a new document",
            status: "success",
            duration: 2000,
            isClosable: true,
          });
        }
      } catch (error) {
        console.error('Error during paste processing:', error);
        toast({
          title: "Error processing paste",
          description: "Failed to process pasted content",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    }
  };

  // Paste from clipboard via button click (uses navigator.clipboard API)
  const handleClipboardImport = async () => {
    try {
      // Try to read HTML first (preserves formatting), fall back to plain text
      let content = '';
      let plainText = '';
      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            content = await blob.text();
          }
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            plainText = await blob.text();
          }
        }
      } catch {
        // Fallback to readText if read() is not supported
        plainText = await navigator.clipboard.readText();
      }

      if (!content.trim()) content = plainText;
      if (!plainText.trim()) plainText = content;

      if (!content.trim()) {
        toast({
          title: "Clipboard empty",
          description: "Nothing to paste",
          status: "warning",
          duration: 2000,
          isClosable: true,
        });
        return;
      }

      let newActivityId;
      if (selectedProject) {
        newActivityId = await onAddBlankActivity();
      } else {
        newActivityId = await onAddUnassignedActivity();
      }

      if (newActivityId) {
        const firstLine = plainText.split('\n')[0].trim();
        const documentName = firstLine.length > 50
          ? firstLine.substring(0, 47) + '...'
          : firstLine || 'Pasted Document';

        await onUpdateActivityName(newActivityId, documentName);
        await invoke("update_project_activity_text", {
          activityId: newActivityId,
          text: content,
        });

        invoke("vectorize_document_chunks", { documentId: newActivityId })
          .catch(e => console.log('Vectorization skipped:', e));

        onSelectActivity(newActivityId);

        toast({
          title: "Content pasted",
          description: "Clipboard content saved as a new document",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error('Clipboard import error:', error);
      toast({
        title: "Clipboard access denied",
        description: "Please allow clipboard access and try again",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Select a document without forcing a project switch
  const handleDocumentSelect = (document: ActivityDocument) => {
    onSelectActivity(document.id);
  };

  // Delete a document
  const handleDeleteDocument = (e: React.MouseEvent, document: ActivityDocument) => {
    e.stopPropagation();
    onDeleteActivity(document.id);
  };

  return (
    <Flex direction="column" w="full" gap={4} overflow="hidden" h="full">
      <Flex gap={2} w="full" align="center">
        <Menu>
          <Flex position="relative" w="full">
            <StyledMenuButton w="full">
              <Text type="m" bold>
                {selectedProject ? selectedProject.name : 'Select a Project'}
              </Text>
            </StyledMenuButton>

            {selectedProject && (
              <IconButton
                position="absolute"
                right="2"
                top="50%"
                transform="translateY(-50%)"
                aria-label="Unselect project"
                icon={<X size={14} />}
                size="xs"
                variant="ghost"
                zIndex="1"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onUnselectProject();
                }}
                _hover={{ bg: 'gray.100' }}
              />
            )}
          </Flex>

          <ScrollableMenuList minW="240px" w="240px" py={0}>
            {/* Sticky search box */}
            <Box 
              p={2} 
              h="56px" 
              display="flex" 
              alignItems="center" 
              position="sticky" 
              top="0" 
              bg="white" 
              zIndex="1"
            >
              <InputGroup size="sm">
                <InputLeftElement pointerEvents="none">
                  <Search size={14} color="var(--chakra-colors-gray-400)" />
                </InputLeftElement>
                <Input
                  placeholder="Search Projects..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </InputGroup>
            </Box>
            <Divider my={0} />

            {/* "Create New Project" at the top */}
            <MenuItem 
              icon={<FolderPlus size={16} />}
              onClick={onNewProject}
              p={3}
              h="40px"
            >
              <Text type="m">Create New Project</Text>
            </MenuItem>
            <Divider my={2} />

            <Box>
              {filteredProjects.map((project) => (
                <MenuItem 
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  p={3}
                  h="40px"
                >
                  <Flex justify="space-between" align="center" w="full">
                    <Text type="m">{project.name}</Text>
                    <Badge colorScheme="teal" ml={2}>
                      {project.activities.length} notes
                    </Badge>
                  </Flex>
                </MenuItem>
              ))}
            </Box>
          </ScrollableMenuList>
        </Menu>
        {/* Removed the separate "Create New Project" plus icon */}
      </Flex>

      {/* Document list section */}
      <Flex direction="column" w="full" flex={1} minH={0}>
        <Flex justify="space-between" align="center" mb={3}>
          <Text type="m" bold>
            {selectedProject ? `${selectedProject.name} Notes` : "All Notes"}
          </Text>

          <Flex gap={2}>
            {/* Button for creating a new note */}
            <Tooltip label="Create a new note">
              <IconButton
                aria-label="Add new note"
                icon={<FilePlus size={16} />}
                size="sm"
                variant="ghost"
                onClick={handleAddNewDocument}
              />
            </Tooltip>

            {/* Button for importing files */}
            <Tooltip label="Import file (PDF, DOCX, TXT, MD)">
              <IconButton
                aria-label="Import file"
                icon={<FileUp size={16} />}
                size="sm"
                variant="ghost"
                onClick={handleFileImport}
              />
            </Tooltip>

            {/* Button for pasting from clipboard */}
            <Tooltip label="Paste from clipboard">
              <IconButton
                aria-label="Paste from clipboard"
                icon={<ClipboardPaste size={16} />}
                size="sm"
                variant="ghost"
                onClick={handleClipboardImport}
              />
            </Tooltip>

            {/* Only show delete button when a project is selected */}
            {selectedProject && (
              <DeleteProjectButton
                project={selectedProject}
                onDelete={onDeleteProject}
              />
            )}
          </Flex>
        </Flex>
        
        <SearchContainer mb={3}>
          <InputGroup size="md">
            <InputLeftElement pointerEvents="none">
              <Search size={16} color="var(--chakra-colors-gray-400)" />
            </InputLeftElement>
            <Input
              placeholder="Search notes..."
              value={documentSearchTerm}
              onChange={(e) => setDocumentSearchTerm(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              borderRadius="full"
              _focus={{
                boxShadow: "0 0 0 1px var(--chakra-colors-teal-400)",
                borderColor: "teal.400"
              }}
            />
          </InputGroup>
        </SearchContainer>

        <DocumentsContainer 
          onPaste={handlePaste}
          tabIndex={0}
          _focus={{ outline: 'none' }}
        >
          <Box>
            {sortedDocuments.length > 0 ? (
              <>
                {sortedDocuments.map((document) => (
                  <Flex
                    key={document.id}
                    p={3}
                    mb={1}
                    borderRadius="md"
                    align="center"
                    justify="space-between"
                    _hover={{ bg: 'gray.50' }}
                    transition="all 0.2s"
                    bg={selectedActivityId === document.id ? 'teal.50' : 'white'}
                    borderLeft={selectedActivityId === document.id ? '3px solid' : '3px solid transparent'}
                    borderLeftColor={selectedActivityId === document.id ? 'teal.400' : 'transparent'}
                    onClick={() => editingActivityId !== document.id && handleDocumentSelect(document)}
                    cursor="pointer"
                    position="relative"
                    minHeight="55px"
                    role="group"
                  >
                    <Flex align="center" gap={3} flex={1}>
                      <Box color="gray.500">
                        <File size={16} />
                      </Box>
                      <Box flex={1}>
                        {editingActivityId === document.id ? (
                          <Input
                            value={editingName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingName(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={handleKeyDown}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            autoFocus
                            size="sm"
                            variant="unstyled"
                          />
                        ) : (
                          <Box>
                            <DocumentName>
                              {truncateDocumentName(document.name)}
                            </DocumentName>
                            
                            {/* Show project tag only if no project filter is applied */}
                            {!selectedProject && (
                              document.projectName === UNASSIGNED_PROJECT_NAME ? (
                                <></>
                              ) : (
                                <ProjectTag size="sm" variant="subtle">
                                  {document.projectName}
                                </ProjectTag>
                              )
                            )}
                          </Box>
                        )}
                      </Box>
                    </Flex>
                    
                    {/* Three dots menu in the top-right corner */}
                    {!editingActivityId && (
                      <Menu placement="bottom-end" isLazy strategy="fixed">
                        <MenuButton
                          as={IconButton}
                          aria-label="Document options"
                          icon={<MoreHorizontal size={14} />}
                          size="xs"
                          variant="ghost"
                          opacity="0"
                          _groupHover={{ opacity: 1 }}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          position="absolute"
                          top="2"
                          right="2"
                        />
                        <MenuList minW="120px">
                          <MenuItem
                            icon={<Edit size={14} />}
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              handleStartEdit(document);
                            }}
                          >
                            Rename
                          </MenuItem>
                          <MenuItem
                            icon={<Trash2 size={14} />}
                            onClick={(e: React.MouseEvent) => handleDeleteDocument(e, document)}
                            color="red.500"
                          >
                            Delete
                          </MenuItem>
                        </MenuList>
                      </Menu>
                    )}
                  </Flex>
                ))}
                
              </>
            ) : (
              <Flex 
                justify="center" 
                align="center" 
                p={8}
                color="gray.500"
                flexDirection="column"
                gap={2}
              >
                <File size={24} />
                <Text type="m">
                  {documentSearchTerm
                    ? "No matching notes found"
                    : selectedProject
                      ? "No notes yet - create one!"
                      : "No notes yet - start writing!"}
                </Text>
              </Flex>
            )}
          </Box>
        </DocumentsContainer>
      </Flex>

      {/* Pinned voice recording button at bottom */}
      <Box flexShrink={0} pt={2} borderTop="1px solid" borderTopColor="gray.100">
        {isDownloadingModel && (
          <Flex align="center" gap={2} bg="blue.50" borderRadius="full" px={4} py={2} justify="center">
            <Spinner size="xs" color="blue.500" />
            <ChakraText fontSize="sm" fontWeight="500" color="blue.600">
              Downloading model... {downloadProgress}%
            </ChakraText>
          </Flex>
        )}

        {!isRecording && !isTranscribing && !isDownloadingModel && (
          <Button
            leftIcon={<Mic size={18} />}
            onClick={startRecording}
            borderRadius="full"
            size="md"
            variant="outline"
            colorScheme="gray"
            w="full"
            fontWeight="500"
            _hover={{ bg: "gray.50" }}
          >
            Record voice note
          </Button>
        )}

        {isRecording && (
          <Box>
            <Flex align="center" gap={2} bg="red.50" borderRadius="full" px={4} py={2}>
              <Box
                w="8px" h="8px" borderRadius="full" bg="red.500"
                animation="pulse 1.5s ease-in-out infinite"
                sx={{ '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }}
              />
              <ChakraText fontSize="sm" fontWeight="500" color="red.600" flex={1}>
                {formatTime(recordingTime)}
              </ChakraText>
              <Button size="xs" colorScheme="red" borderRadius="full" onClick={stopRecording}
                isLoading={isProcessingRecording} loadingText="Stopping...">
                Stop
              </Button>
            </Flex>
            {settings.use_local_transcription && liveTranscript && (
              <Box mt={2} px={3} py={2} bg="gray.50" borderRadius="md" maxH="100px" overflowY="auto">
                <ChakraText fontSize="xs" color="gray.600" fontStyle="italic">
                  {liveTranscript}
                </ChakraText>
              </Box>
            )}
          </Box>
        )}

        {isTranscribing && (
          <Flex align="center" gap={2} bg="teal.50" borderRadius="full" px={4} py={2} justify="center">
            <Spinner size="xs" color="teal.500" />
            <ChakraText fontSize="sm" fontWeight="500" color="teal.600">
              Transcribing...
            </ChakraText>
          </Flex>
        )}
      </Box>
    </Flex>
  );
};