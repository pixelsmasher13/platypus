import { forwardRef } from "react";
import { IconButton } from "@chakra-ui/react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import styled from "styled-components";
import type { StoredMessage, ChunkSource } from "../../types";
import { MessageMarkdown } from ".";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { SourcesCitation } from "../SourcesCitation";

const MainContainer = styled.div`
  display: flex;
  justify-content: flex-start;
`;

const MessageContainer = styled.div`
  display: flex;
  flex-direction: column;
  background-color: transparent;
  padding: 8px;
  max-width: 100%;
  text-align: left;
  position: relative;
  margin-bottom: 7px;
`;

type AssistantMessageProps = {
  message: StoredMessage;
  isGenerating: boolean;
  sources?: ChunkSource[];
  onOpenDocument?: (documentId: number) => void;
};
export const AssistantMessage = forwardRef<
  HTMLDivElement,
  AssistantMessageProps
>(({ message, isGenerating, sources, onOpenDocument }, ref) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 3000 });

  const onCopy = (value: string) => {
    if (isCopied) return;
    copyToClipboard(value);
  };

  return (
    <MainContainer ref={ref}>
      <MessageContainer>
        <MessageMarkdown content={message.content} />
        {!isGenerating && sources && sources.length > 0 && (
          <SourcesCitation sources={sources} onOpenDocument={onOpenDocument} />
        )}
        {!isGenerating && (
          <IconButton
            aria-label="Copy"
            backgroundColor={"var(--button-icon-secondary-color)"}
            icon={isCopied ? <IconCheck size={10} /> : <IconCopy size={10} />}
            size="xs"
            position="absolute"
            bottom={-3}
            right={1}
            onClick={() => onCopy(message.content)}
            title={isCopied ? "Copied!" : "Copy to clipboard"}
          />
        )}
      </MessageContainer>
    </MainContainer>
  );
});