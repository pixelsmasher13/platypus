import { type FC, useEffect, useState, useRef } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  Flex,
  Box,
  Text,
  useToast,
} from "@chakra-ui/react";
import { readBinaryFile, writeBinaryFile } from "@tauri-apps/api/fs";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { save } from "@tauri-apps/api/dialog";
import { Headphones, Download } from "lucide-react";

export type PodcastResult = {
  file_path: string;
  script: string;
  script_chars: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  result: PodcastResult | null;
};

export const PodcastPlayerModal: FC<Props> = ({ isOpen, onClose, result }) => {
  const toast = useToast();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load the saved MP3 into a Blob URL whenever a new result is shown
  useEffect(() => {
    if (!isOpen || !result) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      try {
        const bytes = await readBinaryFile(result.file_path);
        const blob = new Blob([bytes as unknown as BlobPart], { type: "audio/mpeg" });
        createdUrl = URL.createObjectURL(blob);
        if (!cancelled) setAudioUrl(createdUrl);
      } catch {
        // Fall back to the asset protocol URL
        try {
          if (!cancelled) setAudioUrl(convertFileSrc(result.file_path));
        } catch {
          console.warn("Couldn't load audio for playback; download still works.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [isOpen, result]);

  const handleDownload = async () => {
    if (!result) return;
    try {
      const filePath = await save({
        defaultPath: `podcast-${Date.now()}.mp3`,
        filters: [{ name: "Audio", extensions: ["mp3"] }],
      });
      if (filePath) {
        const bytes = await readBinaryFile(result.file_path);
        await writeBinaryFile(filePath, bytes);
        toast({
          title: "Podcast saved",
          status: "success",
          duration: 3000,
          position: "bottom-right",
        });
      }
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.toString() || "Could not save file.",
        status: "error",
        duration: 4000,
        position: "bottom-right",
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Flex align="center" gap={2}>
            <Headphones size={18} />
            <Text>Podcast</Text>
          </Flex>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {result ? (
            <Flex direction="column" gap={4}>
              <Box>
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} controls style={{ width: "100%" }} />
                ) : (
                  <Text fontSize="sm" color="gray.500">
                    Loading audio…
                  </Text>
                )}
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  Script
                </Text>
                <Box
                  p={3}
                  borderRadius="md"
                  border="1px solid"
                  borderColor="gray.200"
                  bg="gray.50"
                  maxH="240px"
                  overflowY="auto"
                  fontSize="sm"
                  color="gray.700"
                  whiteSpace="pre-wrap"
                >
                  {result.script}
                </Box>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  {result.script_chars.toLocaleString()} characters
                </Text>
              </Box>
            </Flex>
          ) : (
            <Text fontSize="sm" color="gray.500">
              No podcast loaded.
            </Text>
          )}
        </ModalBody>

        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            colorScheme="blue"
            leftIcon={<Download size={14} />}
            onClick={handleDownload}
            isDisabled={!result}
          >
            Save MP3
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
