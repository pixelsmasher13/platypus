import { Box, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

export type LiveTranscriptUpdate = {
  text: string;
  committed_text?: string;
  draft_text?: string;
  is_final: boolean;
};

export function LiveTranscriptPreview({ update }: { update: LiveTranscriptUpdate | null }) {
  const viewport = useRef<HTMLDivElement>(null);
  const committed = update?.committed_text ?? update?.text ?? "";
  const draft = update?.draft_text ?? "";
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [committed, draft]);

  return (
    <Box mt={2} px={3} py={2} bg="gray.50" borderRadius="md" aria-label="Live transcription">
      <Text fontSize="xs" fontWeight="medium" color="gray.500" mb={1}>
        {draft ? "Draft · may change" : "Live transcript"}
      </Text>
      <Box ref={viewport} maxH="100px" overflowY="auto" role="status" aria-live="polite" aria-atomic="true">
        {committed || draft ? <Text fontSize="sm" color="gray.700" whiteSpace="pre-wrap">
          {committed}{committed && draft ? " " : ""}
          {draft && <Text as="span" color="gray.500" fontStyle="italic">{draft}</Text>}
        </Text> : <Text fontSize="xs" color="gray.500">Listening… a draft will appear as you speak.</Text>}
      </Box>
    </Box>
  );
}
