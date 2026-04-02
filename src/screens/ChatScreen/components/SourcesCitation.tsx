import { type FC, useState } from "react";
import styled from "styled-components";
import { Collapse, Tooltip } from "@chakra-ui/react";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import type { ChunkSource } from "../types";
import { SourceModal } from "./SourceModal";

const SourcesContainer = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
`;

const SourcesHeader = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;

  &:hover {
    color: var(--text-primary, #fff);
  }
`;

const SourcesList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
`;

const SourceChip = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--button-secondary-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-secondary, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 200px;

  &:hover {
    background: var(--button-secondary-hover-bg, rgba(255, 255, 255, 0.1));
    border-color: var(--accent-color, #6366f1);
    color: var(--text-primary, #fff);
  }
`;

const SourceIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--accent-color, #6366f1);
  color: white;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
`;

const SourceName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

type SourcesCitationProps = {
  sources: ChunkSource[];
  onOpenDocument?: (documentId: number) => void;
};

// Deduplicate sources by document_id, keeping the first occurrence
function deduplicateSources(sources: ChunkSource[]): ChunkSource[] {
  const seen = new Set<number>();
  return sources.filter(source => {
    if (seen.has(source.document_id)) {
      return false;
    }
    seen.add(source.document_id);
    return true;
  });
}

export const SourcesCitation: FC<SourcesCitationProps> = ({ sources, onOpenDocument }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ChunkSource | null>(null);
  const [fullChunkText, setFullChunkText] = useState<string | undefined>();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const uniqueSources = deduplicateSources(sources);

  if (uniqueSources.length === 0) {
    return null;
  }

  const handleSourceClick = async (source: ChunkSource) => {
    setSelectedSource(source);
    setFullChunkText(undefined);
    setIsModalOpen(true);

    // Fetch the full passage text
    try {
      console.log("[SourcesCitation] Fetching passage text for chunk_id:", source.chunk_id);
      const text = await invoke<string | null>("get_chunk_text", { chunkId: source.chunk_id });
      console.log("[SourcesCitation] Received text:", text ? `${text.length} chars` : "null");
      if (text) {
        setFullChunkText(text);
      }
    } catch (error) {
      console.error("Failed to fetch passage text:", error);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSource(null);
    setFullChunkText(undefined);
  };

  return (
    <SourcesContainer>
      <SourcesHeader onClick={() => setIsExpanded(!isExpanded)}>
        <FileText size={14} />
        <span>{uniqueSources.length} source{uniqueSources.length !== 1 ? 's' : ''}</span>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </SourcesHeader>

      <Collapse in={isExpanded} animateOpacity>
        <SourcesList>
          {uniqueSources.map((source, index) => (
            <Tooltip
              key={source.chunk_id}
              label={source.document_name}
              placement="top"
              hasArrow
            >
              <SourceChip onClick={() => handleSourceClick(source)}>
                <SourceIcon>{index + 1}</SourceIcon>
                <SourceName>{source.document_name}</SourceName>
              </SourceChip>
            </Tooltip>
          ))}
        </SourcesList>
      </Collapse>

      <SourceModal
        isOpen={isModalOpen}
        source={selectedSource}
        fullText={fullChunkText}
        onClose={handleCloseModal}
        onOpenDocument={onOpenDocument}
      />
    </SourcesContainer>
  );
};
