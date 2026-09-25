import { getConfiguredModel } from "../../models/models";
import { type FC, useState, useEffect, useRef, useMemo, Fragment } from "react";
import { type } from "@tauri-apps/api/os";
import {
  Flex,
  Spinner,
  useDisclosure,
  Box,
  IconButton,
  Tooltip,
  Wrap,
  WrapItem,
  useToast,
} from "@chakra-ui/react";
import { Text, NavButton } from "@platypus-app/design";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { runChatTurn } from "./chatTurn";
import type { StoredMessage, Chat, ChunkSource } from "./types";
import { debounce } from "lodash";
import { FileText, X, History, Folder, MessageCircle } from "lucide-react";
import { ScreenContainer } from "@/components/layout";


import {
  UserMessage,
  AssistantMessage,
  ChatHeader,
  ChatInput,
  ChatHistoryList,
  SettingsModal,
  SelectActivityModal,
  NewConversationMessage,
  TipTapEditor,
} from "./components";
import { useGlobalSettings } from "../../Providers/SettingsProvider";
import { usePresentations } from '../../Providers/PresentationsProvider';
import { SidePanel } from "../../components/SidePanel";
import { Projects } from "../../features";
import { useProject } from "../../state";

const ChatContainer = styled.div`
  display: flex;
  grid-area: content;
  align-items: center;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow-y: auto;
`;

const MessagesScrollContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  justify-content: center;
  overflow-y: auto;
  &::-webkit-scrollbar {
    width: 8px;
  }
`;

const MessagesContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--breakpoint-medium);
  flex: 1;
  padding: var(--space-l) var(--space-l) 0 var(--space-l);
  gap: var(--space-xl);
  overflow-anchor: none;
`;

const ActivityTextContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  justify-content: center; /* Center the content */
  overflow-y: auto;
  &::-webkit-scrollbar {
    width: 8px;
  }
`;

const ActivityIcon = styled.div`
  width: 40px;
  height: 50px;
  background-color: #f0f0f0;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
`;

const ActivityPreview = styled.div`
  width: 180px;
  height: 50px;
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
`;

interface SelectedActivity {
  id: number;
  text: string;
}

export const ChatScreen: FC = () => {
  const presentations = usePresentations();
  const [userInput, setUserInput] = useState("");
  const toast = useToast();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number>();
  const [dialogue, setDialogue] = useState<StoredMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const sendingRef = useRef(false);
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const [isLoadingExistingChat, setIsLoadingExistingChat] = useState(false);
  const [dailyOutputTokens, setDailyOutputTokens] = useState(0);
  const [dailyInputTokens, setDailyInputTokens] = useState(0);
  const [lastResetTimestamp, setLastResetTimestamp] = useState("");
  const [isActivityHistoryOpen, setIsActivityHistoryOpen] = useState(false);
  const [selectedActivityTexts, setSelectedActivityTexts] = useState<string[]>([]);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedActivityName, setSelectedActivityName] = useState("");
  const [currentModelId, setCurrentModelId] = useState<string>("");
  
  const {
    state,
    getSelectedProject,
    getSelectedProjectActivityText,
    fetchSelectedActivityText,
    selectProject,
    selectActivity,
    updateActivityName,
    getActivityName,
    addUnassignedActivity,
  } = useProject();
  const [selectedActivityText, setSelectedActivityText] = useState("");
  const [isLoadingActivityText, setIsLoadingActivityText] = useState(false);
  const [currentSources, setCurrentSources] = useState<ChunkSource[]>([]);
  const hasAutoCreatedNote = useRef(false);
  // NotebookLM-style suggested questions for the empty-chat state, cached per
  // project so switching back doesn't trigger another LLM call.
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const suggestionsCacheRef = useRef<Map<number, string[]>>(new Map());
  
  // Selected document context for chat (when document from Unassigned is selected)
  const [selectedDocumentContext, setSelectedDocumentContext] = useState<{
    name: string;
    text: string;
    documentId: number;
  } | null>(null);

  const {
    isOpen: isSettingsOpen,
    onOpen: onSettingsOpen,
    onClose: onSettingsClose,
  } = useDisclosure();
  
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("general");
  const { settings, chatGpt } = useGlobalSettings();

  const debouncedScroll = useMemo(
    () =>
      debounce((ref: HTMLDivElement) => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        scrollTimeoutRef.current = setTimeout(() => {
          ref.scrollTo({
            top: ref.scrollHeight,
            behavior: "smooth",
          });
        }, 100);
      }, 100),
    []
  );

  useEffect(() => {
    fetchChats();
    setDialogue([]);

    const unlisten1 = listen("llm_response", (event: any) => {
      // Handle the llm_response event
      // ...
    });

    const unlisten2 = listen("output_tokens", (event: any) => {
      setDailyOutputTokens((prevTokens) => {
        const updatedTokens = prevTokens + event.payload;
        saveTokenData(updatedTokens);
        return updatedTokens;
      });
    });

    const unlistenInput = listen("input_tokens", (event: any) => {
      setDailyInputTokens((prev) => prev + event.payload);
    });

    retrieveTokenData();
    resetDailyOutputTokens();

    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlistenInput.then((f) => f());
    };
  }, []);

  // Auto-create a new note on startup so user can start typing immediately
  useEffect(() => {
    if (hasAutoCreatedNote.current) return;
    if (state.projects.length === 0) return; // Projects haven't loaded yet

    // Check if there are any existing activities across all projects
    const totalActivities = state.projects.reduce(
      (sum, p) => sum + p.activities.length, 0
    );

    if (totalActivities === 0 && !state.selectedActivityId) {
      hasAutoCreatedNote.current = true;
      addUnassignedActivity().then((newId) => {
        if (newId) {
          selectActivity(newId);
        }
      });
    } else if (!state.selectedActivityId && totalActivities > 0) {
      // Open the most recent existing note instead of creating a new untitled one
      hasAutoCreatedNote.current = true;
      const mostRecentId = Math.max(
        ...state.projects.flatMap((p) => p.activities)
      );
      selectActivity(mostRecentId);
    }
  }, [state.projects]);

  // Fetch activity text only when the selected activity ID changes
  // Removed state.projects from deps to prevent multiple fetches/spinners
  useEffect(() => {
    let cancelled = false;
    if (state.selectedActivityId) {
      setSelectedActivityText("");  // Clear old text immediately so editor remounts fresh
      setSelectedActivityName("");  // Clear old name so it doesn't flash in the new document
      setIsLoadingActivityText(true);
      fetchSelectedActivityText()
        .then((text) => {
          if (cancelled) return;
          setSelectedActivityText(text);
          
          // Use the existing getActivityName function with null check
          // This already searches across all projects including unassigned
          if (state.selectedActivityId !== null) {
            const activityName = getActivityName(state.selectedActivityId);
            setSelectedActivityName(activityName);
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoadingActivityText(false);
        });
    } else {
      setIsLoadingActivityText(false);
      setSelectedActivityText("");
      setSelectedActivityName("");
    }
    return () => { cancelled = true; };
  }, [state.selectedActivityId]);
  
  // Update activity name separately when projects change (without refetching text)
  useEffect(() => {
    if (state.selectedActivityId !== null && selectedActivityText) {
      const activityName = getActivityName(state.selectedActivityId);
      if (activityName && activityName !== selectedActivityName) {
        setSelectedActivityName(activityName);
      }
    }
  }, [state.projects]);

  // Automatically attach the selected document to chat context
  useEffect(() => {
    if (state.selectedActivityId && selectedActivityName) {
      invoke<[string, string] | null>("get_app_project_activity_plain_text", {
        activityId: state.selectedActivityId,
      }).then(result => {
        if (result) {
          const plainText = result[1];
          setSelectedDocumentContext({
            name: selectedActivityName,
            text: plainText,
            documentId: state.selectedActivityId!,
          });
        }
      }).catch(error => {
        console.error("Error fetching plain text for context:", error);
      });
    } else {
      setSelectedDocumentContext(null);
    }
  }, [state.selectedActivityId, selectedActivityName]);

  // Clear document context when its source document is deselected
  const handleClearDocumentContext = () => {
    setSelectedDocumentContext(null);
  };

  const fetchChats = async () => {
    try {
      messageRef.current = null;
      const allChats = await invoke<Chat[]>("get_all_chats");
      setChats(allChats);
      if (selectedChatId && !allChats.some((chat) => chat.id === selectedChatId)) {
        setSelectedChatId(undefined);
        setDialogue([]);
      }
    } catch (error) {
      console.error("Error fetching chats:", error);
    }
  };

  const fetchMessages = async (chatId: number) => {
    try {
      setIsLoadingExistingChat(true);
      const rawMessages = await invoke<Array<Omit<StoredMessage, 'sources'> & { sources?: string }>>(
        "get_messages_by_chat_id",
        { chatId }
      );
      // Parse sources JSON string into ChunkSource array
      const messages: StoredMessage[] = rawMessages.map(msg => ({
        ...msg,
        sources: msg.sources ? JSON.parse(msg.sources) : undefined,
      }));
      setDialogue(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setIsLoadingExistingChat(false);
    }
  };

  const handleSaveText = async (newContent: string, newTitle: string, docId: number) => {
    // Use the documentId passed by TipTapEditor (from its ref) rather than
    // state.selectedActivityId, which may have already changed if the user
    // switched documents while a debounced auto-save was in flight.
    const targetId = docId || state.selectedActivityId;
    if (!targetId) return;

    // Save content (also creates chunks)
    await invoke<void>('update_project_activity_text', {
      activityId: targetId,
      text: newContent,
    });

    // Vectorize chunks (if enabled in settings)
    invoke<number>('vectorize_document_chunks', {
      documentId: targetId,
    }).catch(e => console.log('Vectorization skipped or failed:', e));

    // Save title if changed — look up the current name for this specific document
    const currentName = getActivityName(targetId);
    if (newTitle && newTitle !== currentName) {
      await updateActivityName(targetId, newTitle);
    }

    // Only refetch if this is still the active document
    if (targetId === state.selectedActivityId) {
      await fetchSelectedActivityText();
    }
  };

  const handleActivitySelect = (selectedActivities: SelectedActivity[]) => {
    const newTexts = selectedActivities.map((activity) => activity.text);
    setSelectedActivityTexts((prevTexts) => [...prevTexts, ...newTexts]);
    setIsActivityHistoryOpen(false);
  };

  const handleRemoveActivity = (index: number) => {
    setSelectedActivityTexts((prevTexts) => 
      prevTexts.filter((_, i) => i !== index)
    );
  };
//   // Add this useEffect near your other useEffect hooks in ChatScreen.tsx
// useEffect(() => {
//   // Handler for document assignment events
//   const handleDocumentAssigned = (event: CustomEvent) => {
//     const { newActivityId, projectId, projectName } = event.detail;
    
//     // Update the selected activity to the new one
//     selectActivity(newActivityId);
    
//     // Optional: Show a toast notification
//     toast({
//       title: "Document moved",
//       description: `Document successfully moved to "${projectName}"`,
//       status: "success",
//       duration: 3000,
//       isClosable: true,
//       position: "bottom-right"
//     });
    
//     // Fetch the new document's content
//     setIsLoadingActivityText(true);
//     fetchSelectedActivityText()
//       .then((text) => {
//         setSelectedActivityText(text);
//         if (newActivityId) {
//           const activityName = getActivityName(newActivityId);
//           setSelectedActivityName(activityName);
//         }
//       })
//       .finally(() => {
//         setIsLoadingActivityText(false);
//       });
//   };

//   // Add event listener
//   document.addEventListener('documentAssigned', handleDocumentAssigned as EventListener);
  
//   // Clean up
//   return () => {
//     document.removeEventListener('documentAssigned', handleDocumentAssigned as EventListener);
//   };
// }, []);

  const configuredModel = getConfiguredModel(settings);
  useEffect(() => {
    setCurrentModelId(configuredModel);
  }, [configuredModel, settings.api_choice]);

  useEffect(() => {
    if (selectedChatId) {
      setDialogue([]);
      fetchMessages(selectedChatId);
      selectActivity(null);
    } else {
      // No chat selected = new chat state
      setDialogue([]);
      selectActivity(null);
    }
  }, [selectedChatId]);

  // Fetch suggested questions for the selected project. Best-effort: any
  // failure (no API key, empty project, provider down) just leaves the chips
  // hidden — never surface an error for a background nicety.
  useEffect(() => {
    const projectId = state.selectedProject;
    if (!projectId) {
      setSuggestedQuestions([]);
      return;
    }
    const cached = suggestionsCacheRef.current.get(projectId);
    if (cached) {
      setSuggestedQuestions(cached);
      return;
    }
    let cancelled = false;
    setSuggestedQuestions([]);
    setIsLoadingSuggestions(true);
    // Use the cheap tier where we know one; other providers use their default.
    const modelId = settings.api_choice === "claude" ? "claude-haiku-4-5" : undefined;
    invoke<string[]>("generate_suggested_questions", {
      projectId,
      provider: settings.api_choice,
      modelId,
    })
      .then((questions) => {
        if (cancelled) return;
        suggestionsCacheRef.current.set(projectId, questions);
        setSuggestedQuestions(questions);
      })
      .catch((error) => {
        console.log("Suggested questions unavailable:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSuggestions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.selectedProject, settings.api_choice]);

  const generateName = async (chatId: number, userInput: string) => {
    try {
      const name = settings.api_choice === "openai"
        ? await invoke<string>("generate_conversation_name", { userInput })
        : await invoke<string>("name_conversation", { userInput });
      await invoke<boolean>("update_chat_name", { chatId, name });
      setChats((prevChats) =>
        prevChats.map((chat) => (chat.id === chatId ? { ...chat, name } : chat))
      );
    } catch (error) {
      console.error("Error generating conversation name:", error);
      setChats((prevChats) =>
        prevChats.map((chat) =>
          chat.id === chatId ? { ...chat, name: "Unnamed Chat" } : chat
        )
      );
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getChatId = async (messageText?: string): Promise<number> => {
    if (selectedChatId) {
      return selectedChatId;
    }
    try {
      const chatId = await invoke<number>("create_chat", { name: "New Chat" });
      const currentTime = new Date().toISOString();
      generateName(chatId, messageText ?? userInput);
      setChats([
        {
          id: chatId,
          name: "New Chat",
          created_at: currentTime,
          updated_at: currentTime,
        },
        ...chats,
      ]);
      return chatId;
    } catch (error) {
      console.error("Error creating new chat:", error);
      throw new Error("Error creating new chat");
    }
  };

  const sendPromptToLlm = async (chatId: number, modelId?: string, messageText?: string) => {
    const outgoingText = messageText ?? userInput;
    try {
      const currentDate = new Date();
      const lastResetDate = new Date(lastResetTimestamp);

      if (
        currentDate.getDate() !== lastResetDate.getDate() ||
        currentDate.getMonth() !== lastResetDate.getMonth() ||
        currentDate.getFullYear() !== lastResetDate.getFullYear()
      ) {
        setDailyOutputTokens(0);
        setLastResetTimestamp(currentDate.toISOString());
        saveTokenData(0);
      }

      const conversationHistory = dialogue.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const userMessage = {
        role: "user",
        content: outgoingText,
      };

      const fullConversation = [...conversationHistory, userMessage];

      console.log("Sending conversation history to LLM:", fullConversation);

      const estimatedTokens = 1000; // Adjust this value based on your estimation
      if (dailyOutputTokens + estimatedTokens > 130000000) {
        setDialogue((prevDialogue) => [
          ...prevDialogue,
          {
            id: Date.now(),
            chat_id: chatId,
            role: "assistant",
            content: "You have reached your daily token limit. The limit resets at 12am.",
            created_at: new Date().toISOString(),
          },
        ]);
        setIsLoading(false);
        setIsGenerating(false);
        return;
      }

      // Determine which backend to call based on model ID or settings
      const getProvider = (): "claude" | "openai" | "gemini" | "local" => {
        if (modelId) {
          if (modelId.includes("claude")) return "claude";
          if (modelId.includes("gpt") || modelId.includes("o3") || modelId.includes("o4")) return "openai";
          if (modelId.includes("gemini")) return "gemini";
          if (modelId.includes("llama") || modelId.includes("mistral") || modelId.includes("deepseek")) return "local";
        }
        return settings.api_choice as "claude" | "openai" | "gemini" | "local";
      };

      const provider = getProvider();
      
      // Build combined context every turn so persistent selections (selected document,
      // selected project) reach the model on follow-ups, not just the first turn.
      // The Claude backend places this in the cached system prompt; other engines
      // attach it to the first user message — both rebuild from this each turn.
      // selectedActivityTexts remain one-shot (cleared after send), so they only
      // appear on the turn the user attached them via the modal.
      const contextParts: string[] = [];
      const projectText = await getSelectedProjectActivityText();
      if (projectText) contextParts.push(projectText);
      if (selectedActivityTexts.length > 0) contextParts.push(selectedActivityTexts.join("\n\n"));
      if (selectedDocumentContext) {
        contextParts.push(`\n\n--- Document: ${selectedDocumentContext.name} ---\n${selectedDocumentContext.text}`);
      }
      const combinedActivityText = contextParts.join("\n");
      
      // Get selected project ID for chunk-based retrieval
      const selectedProject = getSelectedProject();
      const projectId = selectedProject?.id ?? null;

      // The legacy IPC flag enables retrieval. Retrieve on every question,
      // including follow-ups and reopened chats, so citations remain grounded.
      const retrieveSources = settings.vectorization_enabled;

      switch (provider) {
        case "openai":
          await invoke("send_prompt_to_openai", {
            conversationHistory: fullConversation,
            isFirstMessage: retrieveSources,
            combinedActivityText,
            modelId,
            projectId
          });
          break;
        case "gemini":
          await invoke("send_prompt_to_gemini", {
            conversationHistory: fullConversation,
            isFirstMessage: retrieveSources,
            combinedActivityText,
            modelId,
            projectId
          });
          break;
        case "local":
          await invoke("send_prompt_to_local", {
            conversationHistory: fullConversation,
            isFirstMessage: retrieveSources,
            combinedActivityText,
            modelId,
            projectId
          });
          break;
        case "claude":
        default:
          await invoke("send_prompt_to_llm", {
            conversationHistory: fullConversation,
            isFirstMessage: retrieveSources,
            combinedActivityText,
            modelId,
            projectId
          });
          break;
      }

      await invoke("create_message", {
        chatId,
        role: "user",
        content: outgoingText,
        sources: null,
      });

      setSelectedActivityTexts([]);
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error from LLM API:", rawErrorMessage);

      // Check for prompt too long / context length errors
      const isPromptTooLong = rawErrorMessage.toLowerCase().includes("too long") ||
        rawErrorMessage.toLowerCase().includes("context length") ||
        rawErrorMessage.toLowerCase().includes("maximum context") ||
        rawErrorMessage.toLowerCase().includes("token limit") ||
        rawErrorMessage.toLowerCase().includes("too many tokens");

      let displayMessage: string;
      if (isPromptTooLong) {
        displayMessage = settings.vectorization_enabled
          ? "The selected documents are too large to process. Try selecting fewer documents or shorter content."
          : "The selected documents are too large to send in full. Enable **Document Indexing** in Settings > General to automatically retrieve only the most relevant passages from your documents.";
      } else {
        displayMessage = rawErrorMessage || "An unexpected error occurred";
      }

      setDialogue((prevDialogue) => [
        ...prevDialogue,
        {
          id: Date.now(),
          chat_id: chatId,
          role: "assistant",
          content: displayMessage,
          created_at: new Date().toISOString(),
          sources: [],
        },
      ]);
      throw error;
    }
  };

  const handleSubmit = async (modelId?: string, textOverride?: string) => {
    const selectedModelId = modelId || currentModelId;
    const messageText = textOverride ?? userInput;
    if (!messageText.trim() || sendingRef.current) return;
    
    // Check API keys based on provider
    const checkApiKeys = (): { valid: boolean; message?: string } => {
      // OpenAI key is only needed if vectorization is enabled
      if (settings.vectorization_enabled && !settings.api_key_open_ai) {
        return {
          valid: false,
          message: "OpenAI API key is required for document indexing. Provide it in Settings > General or disable indexing."
        };
      }

      // Check provider-specific keys
      if (settings.api_choice === "openai" && !settings.api_key_open_ai && !chatGpt.signed_in) {
        return {
          valid: false,
          message: "Add an OpenAI API key or sign in with ChatGPT in Settings > General."
        };
      }
      if (settings.api_choice === "claude" && !settings.api_key_claude) {
        return {
          valid: false,
          message: "Claude API key not provided. Provide it in Settings > General."
        };
      }
      if (settings.api_choice === "gemini" && !settings.api_key_gemini) {
        return {
          valid: false,
          message: "Gemini API key not provided. Provide it in Settings > General."
        };
      }
      // Local models don't need an API key
      return { valid: true };
    };

    const keyCheck = checkApiKeys();
    if (!keyCheck.valid) {
      toast({
        title: "API key not provided",
        description: keyCheck.message,
        status: "error",
        duration: 9000,
        isClosable: true,
      });
      onSettingsOpen();
      return;
    }
    if (selectedActivityText) {
      selectActivity(null);
      setSelectedActivityText("");
    }
    
    sendingRef.current = true;
    setIsLoading(true);
    setIsGenerating(true);
    setFirstTokenReceived(false);

    try {
      let chatId: number;
      if (dialogue.length > 0) {
        chatId = dialogue[dialogue.length - 1].chat_id;
      } else {
        chatId = await getChatId(messageText);
      }
      setDialogue((prevDialogue) => [
        ...prevDialogue,
        {
          id: Date.now(),
          chat_id: chatId,
          role: "user",
          content: messageText,
          created_at: new Date().toISOString(),
        },
      ]);
      setUserInput("");
      setCurrentSources([]); // Clear sources for new message

      const assistantId = Date.now() + 1;
      const response = await runChatTurn(
        (event, callback) => listen(event, event => callback(event.payload)),
        () => sendPromptToLlm(chatId, selectedModelId, messageText),
        ({ content, sources }) => {
          setCurrentSources(sources);
          if (!content) return;
          setFirstTokenReceived(true);
          setDialogue(previous => {
            const message = { id: assistantId, chat_id: chatId, role: "assistant" as const,
              content, sources, created_at: new Date().toISOString() };
            return previous.some(item => item.id === assistantId)
              ? previous.map(item => item.id === assistantId ? message : item)
              : [...previous, message];
          });
        },
      );
      await invoke("create_message", {
        chatId,
        role: "assistant",
        content: response.content,
        sources: response.sources.length ? JSON.stringify(response.sources) : null,
      });
    } catch (error) {
      console.error("ChatScreen: handleSubmit has failed", error);
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
      setIsGenerating(false);
    }
  };

  const handleChatHistoryToggle = () => {
    setIsChatHistoryOpen(!isChatHistoryOpen);
  };

  const handleActivityHistoryToggle = () => {
    setIsActivityHistoryOpen(!isActivityHistoryOpen);
  };

  const handleDeleteChat = async (chatId: number) => {
    try {
      await invoke("delete_chat", { chatId });
      setChats(chats.filter((chat) => chat.id !== chatId));
      if (selectedChatId === chatId) {
        setSelectedChatId(undefined);
        setDialogue([]);
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const isMacOS = useRef<boolean | null>(null);
  const osCheckComplete = useRef<boolean>(false);

  useEffect(() => {
    const checkOSTypeAndScroll = async () => {
      if (!osCheckComplete.current) {
        const osType = await type();
        isMacOS.current = osType === "Darwin";
        osCheckComplete.current = true;
      }

      if (messageContainerRef.current && isGenerating) {
        if (isMacOS.current) {
          messageContainerRef.current.scrollTo(
            0,
            messageContainerRef.current.scrollHeight
          );
        } else {
          debouncedScroll(messageContainerRef.current);
        }
      } else if (messageRef.current) {
        messageRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }
    };

    checkOSTypeAndScroll();
  }, [messageRef, dialogue, isGenerating, debouncedScroll]);

  const saveTokenData = (tokens: number) => {
    localStorage.setItem("dailyOutputTokens", tokens.toString());
    localStorage.setItem("lastResetTimestamp", new Date().toISOString());
  };

  const retrieveTokenData = () => {
    const storedTokens = localStorage.getItem("dailyOutputTokens");
    const storedTimestamp = localStorage.getItem("lastResetTimestamp");

    if (storedTokens && storedTimestamp) {
      const lastResetDate = new Date(storedTimestamp);
      const currentDate = new Date();

      if (
        lastResetDate.getDate() === currentDate.getDate() &&
        lastResetDate.getMonth() === currentDate.getMonth() &&
        lastResetDate.getFullYear() === currentDate.getFullYear()
      ) {
        setDailyOutputTokens(parseInt(storedTokens, 10));
        setLastResetTimestamp(storedTimestamp);
      } else {
        setDailyOutputTokens(0);
        setLastResetTimestamp(currentDate.toISOString());
        saveTokenData(0);
      }
    } else {
      setDailyOutputTokens(0);
      setLastResetTimestamp(new Date().toISOString());
      saveTokenData(0);
    }
  };

  const resetDailyOutputTokens = () => {
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0
    );
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      setDailyOutputTokens(0);
      setLastResetTimestamp(midnight.toISOString());
      saveTokenData(0);
    }, timeUntilMidnight);
  };

  const onClickNewChat = () => {
    setSelectedChatId(undefined);
    setDialogue([]);
    setIsGenerating(false);
    setFirstTokenReceived(false);
    setSelectedActivityTexts([]);
    selectActivity(null);
    setSelectedActivityText("");
  };

  return (
    <ScreenContainer>
      <ChatHeader
        profileMenu={<Flex align="center" gap={2}><NavButton onClick={presentations.openLibrary}>Presentations{presentations.runningCount ? ` (${presentations.runningCount})` : ''}</NavButton><NavButton onClick={onSettingsOpen}>Settings</NavButton></Flex>}
      />
      <SidePanel
        gridArea={"sidebar"}
        pages={[
          {
            icon: <Folder size={20} />,
            text: "Notes",
            content: (
              <Projects
                selectedActivityId={state.selectedActivityId}
                onSelectActivity={selectActivity}
              />
            ),
          }, {
            icon: (
              <Tooltip label="Chat History" placement="bottom">
        <MessageCircle size={20} />
        </Tooltip>
            ),
            text: "Chats",
            content: (
              <ChatHistoryList
                chatHistory={chats}
                onNewChat={onClickNewChat}
                selectedChatId={selectedChatId}
                deleteChat={handleDeleteChat}
                selectChatId={(chatId) => {
                  setSelectedChatId(chatId);
                  setIsChatHistoryOpen(false);
                  setSelectedActivityTexts([]);
                }}
              />
            ),
          },
         
        ]}
      />
      <ChatContainer>
      {state.selectedActivityId || isLoadingActivityText ? (
  <ActivityTextContainer>
    <Box 
      width="100%"
      maxWidth="90%" /* Increased from var(--breakpoint-medium) to 90% of available width */
      padding="var(--space-l) var(--space-l) 0 var(--space-l)"
    >
{isLoadingActivityText ? (
  <>
    <Flex justify="center" mt={2}>
      <Text type="s">Loading document content...</Text>
    </Flex>
    <Flex justify="center" mt={2}>
      <Spinner />
    </Flex>
  </>
) : (
  <TipTapEditor
    content={selectedActivityText}
    title={selectedActivityName}
    documentId={state.selectedActivityId || 0}
    onSave={handleSaveText}
  />
)}
    </Box>
  </ActivityTextContainer>
) : (
          <>
            {dialogue.length === 0 && !isLoadingExistingChat ? (
              <NewConversationMessage
                suggestions={state.selectedProject ? suggestedQuestions : []}
                isLoadingSuggestions={!!state.selectedProject && isLoadingSuggestions}
                onSelectSuggestion={(question) => {
                  if (!isGenerating && !isLoading) handleSubmit(undefined, question);
                }}
              />
            ) : (
              <MessagesScrollContainer ref={messageContainerRef}>
                <MessagesContainer>
                  {dialogue.map((message, index) => {
                    const messageProps =
                      index === dialogue.length - 1
                        ? {
                            ref: messageRef,
                          }
                        : {};
                    return (
                      <Fragment key={message.id}>
                        {message.role === "user" && (
                          <UserMessage
                            key={message.id}
                            message={message}
                            name={"You"}
                            {...messageProps}
                          />
                        )}
                        {message.role === "assistant" && (
                          <>
                            <AssistantMessage
                              key={message.id}
                              message={message}
                              isGenerating={isGenerating}
                              sources={message.sources ?? (index === dialogue.length - 1 ? currentSources : undefined)}
                              onOpenDocument={(documentId) => {
                                // Navigate to the document when "Open Document" is clicked in modal
                                selectActivity(documentId);
                              }}
                              {...messageProps}
                            />
                          </>
                        )}
                      </Fragment>
                    );
                  })}
                  {!firstTokenReceived && isGenerating && (
                    <Flex justify="center" mt={2}>
                      <Text type="s">Assistant is typing...</Text>
                    </Flex>
                  )}
                  {isGenerating && (
                    <Flex justify="center" mt={2}>
                      <Spinner />
                    </Flex>
                  )}
                </MessagesContainer>
                {isLoadingExistingChat && (
                  <Flex justify="center" mt={2}>
                    <Spinner />
                  </Flex>
                )}
              </MessagesScrollContainer>
            )}
          </>
        )}
        {selectedActivityTexts.length > 0 && (
          <Box mt={4} p={4} maxWidth="var(--breakpoint-medium)" mx="auto">
            <Wrap spacing={4}>
              {selectedActivityTexts.map((text, index) => (
                <WrapItem key={index}>
                  <Flex>
                    <ActivityIcon>
                      <FileText size={24} />
                      <IconButton
                        icon={<X size={16} />}
                        size="xs"
                        aria-label="Remove activity"
                        position="absolute"
                        top="-8px"
                        right="-8px"
                        borderRadius="full"
                        onClick={() => handleRemoveActivity(index)}
                      />
                    </ActivityIcon>
                    <ActivityPreview>
                      {text.length > 50 ? `${text.substring(0, 50)}...` : text}
                    </ActivityPreview>
                  </Flex>
                </WrapItem>
              ))}
            </Wrap>
          </Box>
        )}
      <ChatInput
        value={userInput}
        onChange={handleInputChange}
        onKeyDown={handleKeyPress}
        onSubmit={handleSubmit}
        onActivityHistoryToggle={handleActivityHistoryToggle}
        isGenerating={isGenerating}
        isLoading={isLoading}
        selectedDocument={selectedDocumentContext ? {
          name: selectedDocumentContext.name,
        } : undefined}
        onRemoveSelectedDocument={handleClearDocumentContext}
      />
      </ChatContainer>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={onSettingsClose}
        activeCategory={activeSettingsCategory}
        setActiveCategory={setActiveSettingsCategory}
      />
      <SelectActivityModal
        isOpen={isActivityHistoryOpen}
        onClose={handleActivityHistoryToggle}
        onSelect={handleActivitySelect}
      />
    </ScreenContainer>
  );
};
