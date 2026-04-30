import { type FC, useState, useRef, useEffect } from "react";
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
  Spinner,
  Text,
  Textarea,
  HStack,
  Select,
  Input,
  Link,
  useToast,
} from "@chakra-ui/react";
import { invoke } from "@tauri-apps/api/tauri";
import { save } from "@tauri-apps/api/dialog";
import { readBinaryFile, writeBinaryFile } from "@tauri-apps/api/fs";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { Headphones, Download, RefreshCw } from "lucide-react";

type PodcastResult = {
  file_path: string;
  script: string;
  script_chars: number;
};

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  plainText: string;
  provider: string;
  modelId?: string;
};

const CUSTOM_VOICE_VALUE = "__custom__";

/// Premade voices come from ElevenLabs' shared library and require a paid plan to call via API.
/// Filter them out so the dropdown only shows voices the user can actually use:
/// their own clones, generated voices, or professional clones.
function filterUsableVoices(voices: ElevenLabsVoice[]): ElevenLabsVoice[] {
  return voices.filter((v) => (v.category ?? "").toLowerCase() !== "premade");
}

const LENGTH_OPTIONS = [
  { minutes: 1, label: "1 min" },
  { minutes: 3, label: "3 min" },
  { minutes: 5, label: "5 min" },
];

export const PodcastGeneratorModal: FC<Props> = ({
  isOpen,
  onClose,
  plainText,
  provider,
  modelId,
}) => {
  const toast = useToast();
  const [focus, setFocus] = useState("");
  const [lengthMinutes, setLengthMinutes] = useState<number>(3);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>(CUSTOM_VOICE_VALUE);
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<PodcastResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // On modal open, fetch the user's voices and filter to only those usable on free tier.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingVoices(true);
    setVoicesError(null);
    invoke<ElevenLabsVoice[]>("list_elevenlabs_voices")
      .then((fetched) => {
        if (cancelled) return;
        const usable = filterUsableVoices(fetched);
        setVoices(usable);
        if (usable.length > 0) {
          setVoiceId(usable[0].voice_id);
        } else {
          setVoiceId(CUSTOM_VOICE_VALUE);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.toString() ?? "Could not fetch voices.";
        setVoicesError(msg);
        setVoiceId(CUSTOM_VOICE_VALUE);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const reset = () => {
    setFocus("");
    setLengthMinutes(3);
    setVoiceId(voices[0]?.voice_id ?? CUSTOM_VOICE_VALUE);
    setCustomVoiceId("");
    setResult(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
  };

  const handleClose = () => {
    if (!isGenerating) {
      reset();
      onClose();
    }
  };

  const handleGenerate = async () => {
    if (!plainText.trim()) {
      toast({
        title: "Nothing to generate from",
        description: "This note is empty.",
        status: "warning",
        duration: 3000,
        position: "bottom-right",
      });
      return;
    }

    const effectiveVoiceId = voiceId === CUSTOM_VOICE_VALUE ? customVoiceId.trim() : voiceId;
    if (!effectiveVoiceId) {
      toast({
        title: "Voice ID required",
        description: "Paste a voice ID from your ElevenLabs library.",
        status: "warning",
        duration: 3000,
        position: "bottom-right",
      });
      return;
    }

    setIsGenerating(true);
    setResult(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const res = await invoke<PodcastResult>("generate_podcast_from_document", {
        plainText,
        provider,
        modelId,
        focus: focus.trim() || null,
        lengthMinutes,
        voiceId: effectiveVoiceId,
      });
      setResult(res);

      // Load the saved MP3 into a blob URL so the inline <audio> can play it
      try {
        const bytes = await readBinaryFile(res.file_path);
        const blob = new Blob([new Uint8Array(bytes).buffer], { type: "audio/mpeg" });
        setAudioUrl(URL.createObjectURL(blob));
      } catch (e) {
        // Fallback: try the Tauri file URL converter
        try {
          setAudioUrl(convertFileSrc(res.file_path));
        } catch {
          console.warn("Couldn't load audio for playback; download still works.");
        }
      }
    } catch (error: any) {
      console.error("Podcast generation failed:", error);
      toast({
        title: "Couldn't generate podcast",
        description: error?.toString() || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-right",
      });
    } finally {
      setIsGenerating(false);
    }
  };

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
    <Modal isOpen={isOpen} onClose={handleClose} size="2xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Flex align="center" gap={2}>
            <Headphones size={18} />
            <Text>Generate podcast</Text>
          </Flex>
        </ModalHeader>
        <ModalCloseButton isDisabled={isGenerating} />

        <ModalBody>
          {!result ? (
            <Flex direction="column" gap={4}>
              <Box>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  Focus or style{" "}
                  <Text as="span" color="gray.500" fontWeight="400">
                    (optional)
                  </Text>
                </Text>
                <Textarea
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="e.g., explain it like I'm new to the topic, focus on the action items"
                  size="sm"
                  rows={3}
                  isDisabled={isGenerating}
                />
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="500" mb={2}>
                  Length
                </Text>
                <HStack spacing={2}>
                  {LENGTH_OPTIONS.map(({ minutes, label }) => (
                    <Button
                      key={minutes}
                      size="sm"
                      variant={lengthMinutes === minutes ? "solid" : "outline"}
                      colorScheme={lengthMinutes === minutes ? "blue" : "gray"}
                      onClick={() => setLengthMinutes(minutes)}
                      isDisabled={isGenerating}
                      borderRadius="full"
                      minW="60px"
                    >
                      {label}
                    </Button>
                  ))}
                </HStack>
              </Box>

              <Box>
                <Flex justify="space-between" align="center" mb={2}>
                  <Text fontSize="sm" fontWeight="500">
                    Voice
                  </Text>
                  {isLoadingVoices && <Spinner size="xs" color="gray.400" />}
                </Flex>
                <Select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  size="sm"
                  isDisabled={isGenerating || isLoadingVoices}
                >
                  {voices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name}
                      {v.category ? ` (${v.category})` : ""}
                    </option>
                  ))}
                  <option value={CUSTOM_VOICE_VALUE}>Custom voice ID…</option>
                </Select>
                {voiceId === CUSTOM_VOICE_VALUE && (
                  <Input
                    mt={2}
                    size="sm"
                    value={customVoiceId}
                    onChange={(e) => setCustomVoiceId(e.target.value)}
                    placeholder="Paste an ElevenLabs voice ID"
                    isDisabled={isGenerating}
                  />
                )}
                {!isLoadingVoices && voices.length === 0 && !voicesError && (
                  <Text fontSize="xs" color="orange.600" mt={1.5}>
                    No usable voices in your library. ElevenLabs' premade library voices
                    require a paid plan via API. Either{" "}
                    <Link
                      href="https://elevenlabs.io/app/voice-lab"
                      isExternal
                      color="blue.500"
                      textDecoration="underline"
                    >
                      add a custom voice
                    </Link>{" "}
                    (Voice Design / Cloning) or upgrade your plan.
                  </Text>
                )}
                {voicesError && (
                  <Text fontSize="xs" color="orange.600" mt={1.5}>
                    Couldn't load voices: {voicesError}
                  </Text>
                )}
              </Box>

              {isGenerating && (
                <Flex align="center" gap={2} py={4} color="gray.600">
                  <Spinner size="sm" />
                  <Text fontSize="sm">
                    Writing script and synthesizing audio… this can take 30-60 seconds.
                  </Text>
                </Flex>
              )}
            </Flex>
          ) : (
            <Flex direction="column" gap={4}>
              <Box>
                {audioUrl ? (
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    style={{ width: "100%" }}
                  />
                ) : (
                  <Text fontSize="sm" color="gray.500">
                    Audio saved — playback unavailable in app, but download works.
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
          )}
        </ModalBody>

        <ModalFooter gap={2}>
          {!result ? (
            <>
              <Button variant="ghost" onClick={handleClose} isDisabled={isGenerating}>
                Cancel
              </Button>
              <Button
                colorScheme="blue"
                onClick={handleGenerate}
                isLoading={isGenerating}
                loadingText="Generating"
                leftIcon={<Headphones size={14} />}
              >
                Generate
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                leftIcon={<RefreshCw size={14} />}
                onClick={() => {
                  setResult(null);
                  if (audioUrl) URL.revokeObjectURL(audioUrl);
                  setAudioUrl(null);
                }}
              >
                Regenerate
              </Button>
              <Button
                colorScheme="blue"
                leftIcon={<Download size={14} />}
                onClick={handleDownload}
              >
                Save MP3
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
