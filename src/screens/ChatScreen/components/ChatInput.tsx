import {
  type FC,
  type ChangeEvent,
  type KeyboardEvent,
  useRef,
  useEffect,
  useState,
} from "react";
import {
  Text,
  Textarea,
  Button,
  Flex,
  IconButton,
  Tooltip,
  Box,
} from "@chakra-ui/react";
import { PaperclipIcon, FileText, X } from "lucide-react";
import { ProjectBadge } from "../../../features/ProjectBadge";
import { ModelSelector } from "./ModelSelector";
import { useGlobalSettings } from "../../../Providers/SettingsProvider";

export type SelectedDocumentContext = {
  name: string;
  projectName?: string;
};

type ChatInputProps = {
  value: string;
  onSubmit: (modelId?: string) => void; // Updated to accept modelId
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onActivityHistoryToggle: () => void;
  isLoading: boolean;
  isGenerating: boolean;
  selectedDocument?: SelectedDocumentContext;
  onRemoveSelectedDocument?: () => void;
};

export const ChatInput: FC<ChatInputProps> = ({
  value,
  onSubmit,
  onChange,
  onKeyDown,
  onActivityHistoryToggle,
  isLoading,
  isGenerating,
  selectedDocument,
  onRemoveSelectedDocument,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings } = useGlobalSettings();
  
  // Initialize with default model based on provider preference
  const defaultModel = (() => {
    switch (settings.api_choice) {
      case "claude": return "claude-sonnet-4-6";
      case "openai": return "gpt-5.4";
      case "gemini": return "gemini-3-pro-preview";
      case "local": return "llama3.3:70b";
      default: return "claude-sonnet-4-6";
    }
  })();
  
  const [currentModel, setCurrentModel] = useState(defaultModel);
  const [currentProvider, setCurrentProvider] = useState<"claude" | "openai" | "gemini" | "local">(settings.api_choice);

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px"; // Reset to initial height
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height =
        scrollHeight > 40 ? `${scrollHeight}px` : "40px";
    }
  };

  useEffect(() => {
    handleInput();
  }, [value]);

  const handleSubmit = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px"; // Reset the height to the initial value
    }
    onSubmit(currentModel); // Pass the currently selected model to parent
  };

  const handleModelChange = (modelId: string, provider: "claude" | "openai" | "gemini" | "local") => {
    setCurrentModel(modelId);
    setCurrentProvider(provider);
  };

  return (
    <Box width="100%" maxWidth="var(--breakpoint-medium)" mx="auto" p={4}>
      <Flex justifyContent="space-between" alignItems="center" mb={2}>
        <Flex gap={3} alignItems="center">
          <ProjectBadge />
          {selectedDocument && (
            <Box
              display="flex"
              alignItems="center"
              gap={2}
              px={3}
              py={1}
              bg="var(--secondary-color)"
              borderRadius="full"
              fontSize="sm"
              border="1px solid"
              borderColor="var(--default-border-color)"
            >
              <FileText size={14} color="var(--text-default-color)" />
              <Text fontSize="sm" maxW="150px" isTruncated color="var(--text-default-color)">
                {selectedDocument.name}
              </Text>
              {onRemoveSelectedDocument && (
                <IconButton
                  icon={<X size={14} />}
                  aria-label="Remove document from context"
                  size="xs"
                  variant="ghost"
                  onClick={onRemoveSelectedDocument}
                  minW="auto"
                  h="auto"
                  p={0}
                  color="var(--text-default-color)"
                  _hover={{ bg: "var(--secondary-hover-color)" }}
                />
              )}
            </Box>
          )}
        </Flex>
        <Box ml="auto">
          <ModelSelector 
            onModelChange={handleModelChange}
            currentModel={currentModel}
          />
        </Box>
      </Flex>
      
      <Flex
        as="form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        flexDirection={"column"}
        alignItems={"flex-start"}
        width="100%"
        gap={"4px"}
      >
        <Flex alignItems="flex-end" width="100%">
          <Textarea
            value={value}
            ref={textareaRef}
            onChange={(e) => {
              onChange(e);
              handleInput();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              } else {
                onKeyDown(e);
              }
            }}
            placeholder="Ask Platypus anything..."
            resize="none"
            rows={1}
            mr={2}
            flex={1}
            disabled={isGenerating}
            height="40px"
            overflow="hidden"
          />
         <Tooltip label="Attach a note to your prompt" placement="top">
            <IconButton
              icon={<PaperclipIcon size={20} />}
              aria-label="Add content"
              onClick={onActivityHistoryToggle}
              mr={2}
              variant="ghost"
              isRound
            />
          </Tooltip>
          <Button
            type="submit"
            isLoading={isLoading || isGenerating}
            loadingText="Sending"
            isDisabled={isGenerating || !value}
          >
            Send
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
};