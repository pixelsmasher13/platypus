import { type FC, useState, useMemo } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Button,
  Flex,
  Box,
  Spinner,
  Center,
  Input,
  InputGroup,
  InputLeftElement,
  Text,
} from "@chakra-ui/react";
import { FileText, ExternalLink, Search } from "lucide-react";
import styled from "styled-components";
import type { ChunkSource } from "../types";

const SourceHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary, #888);
  font-size: 12px;
  margin-bottom: 4px;
`;

const DocumentName = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  margin: 0;
`;

const PassageContent = styled.div`
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
  max-height: 400px;
  min-height: 100px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: #ccc;
    border-radius: 3px;
  }

  mark {
    background-color: #fff59d;
    color: #333;
    padding: 0 2px;
    border-radius: 2px;
  }
`;

interface SourceModalProps {
  isOpen: boolean;
  source: ChunkSource | null;
  fullText?: string;
  isLoading?: boolean;
  onClose: () => void;
  onOpenDocument?: (documentId: number) => void;
}

export const SourceModal: FC<SourceModalProps> = ({
  isOpen,
  source,
  fullText,
  isLoading,
  onClose,
  onOpenDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Use fullText if provided, otherwise fall back to passage preview
  const displayText = source ? (fullText || source.chunk_preview) : "";

  // Highlight search matches
  const highlightedContent = useMemo(() => {
    if (!searchQuery.trim() || !displayText) {
      return displayText;
    }

    const query = searchQuery.trim();
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = displayText.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? <mark key={index}>{part}</mark> : part
    );
  }, [displayText, searchQuery]);

  // Count matches
  const matchCount = useMemo(() => {
    if (!searchQuery.trim() || !displayText) return 0;
    const query = searchQuery.trim();
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = displayText.match(regex);
    return matches ? matches.length : 0;
  }, [displayText, searchQuery]);

  const handleClose = () => {
    setSearchQuery("");
    onClose();
  };

  if (!source) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      isCentered
      motionPreset="slideInBottom"
      size="xl"
    >
      <ModalOverlay />
      <ModalContent maxWidth="700px">
        <ModalHeader pb={2}>
          <SourceHeader>
            <FileText size={14} />
            <span>Passage {source.chunk_index + 1}</span>
          </SourceHeader>
          <DocumentName>{source.document_name}</DocumentName>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Flex direction="column" gap={3}>
            <InputGroup size="sm">
              <InputLeftElement pointerEvents="none">
                <Search size={14} color="gray" />
              </InputLeftElement>
              <Input
                placeholder="Search in passage..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                bg="white"
                borderColor="#e0e0e0"
                _placeholder={{ color: "gray.400" }}
              />
              {searchQuery && (
                <Text
                  position="absolute"
                  right="10px"
                  top="50%"
                  transform="translateY(-50%)"
                  fontSize="xs"
                  color="gray.500"
                >
                  {matchCount} {matchCount === 1 ? "match" : "matches"}
                </Text>
              )}
            </InputGroup>

            <PassageContent>
              {isLoading ? (
                <Center h="100px">
                  <Spinner size="sm" color="gray.500" />
                </Center>
              ) : (
                highlightedContent
              )}
            </PassageContent>

            {onOpenDocument && (
              <Box>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<ExternalLink size={14} />}
                  onClick={() => {
                    onOpenDocument(source.document_id);
                    handleClose();
                  }}
                >
                  Open Document
                </Button>
              </Box>
            )}
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
