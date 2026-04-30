import { type FC, useState, useEffect } from "react";
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
import { Headphones } from "lucide-react";

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
};

export type PodcastGenerationParams = {
  plainText: string;
  provider: string;
  modelId?: string;
  focus: string | null;
  lengthMinutes: number;
  voiceId: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  plainText: string;
  provider: string;
  modelId?: string;
  /** Called when user submits the form. Generation runs in the background — modal closes immediately. */
  onSubmit: (params: PodcastGenerationParams) => void;
};

const CUSTOM_VOICE_VALUE = "__custom__";

// Public ElevenLabs library voice IDs. Free-tier API access to these returns 402
// (paid plan required), but they show up so paid users can use them with one click,
// and free users have something to try before adding a custom voice.
const PRESET_LIBRARY_VOICES: ElevenLabsVoice[] = [
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "library" },
  { voice_id: "EXAVITQu4vr4xnSDxMAi", name: "Bella", category: "library" },
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "library" },
  { voice_id: "ErXwobaYiN019PkySvjV", name: "Antoni", category: "library" },
  { voice_id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", category: "library" },
];

function splitUserAndLibrary(voices: ElevenLabsVoice[]): {
  user: ElevenLabsVoice[];
  library: ElevenLabsVoice[];
} {
  const user: ElevenLabsVoice[] = [];
  const library: ElevenLabsVoice[] = [];
  for (const v of voices) {
    if ((v.category ?? "").toLowerCase() === "premade") {
      library.push({ ...v, category: "library" });
    } else {
      user.push(v);
    }
  }
  return { user, library };
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
  onSubmit,
}) => {
  const toast = useToast();
  const [focus, setFocus] = useState("");
  const [lengthMinutes, setLengthMinutes] = useState<number>(3);
  const [userVoices, setUserVoices] = useState<ElevenLabsVoice[]>([]);
  const [libraryVoices, setLibraryVoices] = useState<ElevenLabsVoice[]>(PRESET_LIBRARY_VOICES);
  const [voiceId, setVoiceId] = useState<string>(PRESET_LIBRARY_VOICES[0].voice_id);
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesFetchFailed, setVoicesFetchFailed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingVoices(true);
    setVoicesFetchFailed(false);
    invoke<ElevenLabsVoice[]>("list_elevenlabs_voices")
      .then((fetched) => {
        if (cancelled) return;
        const { user, library } = splitUserAndLibrary(fetched);
        setUserVoices(user);
        if (library.length > 0) setLibraryVoices(library);
        if (user.length > 0) setVoiceId(user[0].voice_id);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Could not fetch ElevenLabs voices:", err);
        setVoicesFetchFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleClose = () => {
    onClose();
  };

  const handleSubmit = () => {
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

    onSubmit({
      plainText,
      provider,
      modelId,
      focus: focus.trim() || null,
      lengthMinutes,
      voiceId: effectiveVoiceId,
    });

    onClose();
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
        <ModalCloseButton />

        <ModalBody>
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
                isDisabled={isLoadingVoices}
              >
                {userVoices.length > 0 && (
                  <optgroup label="Your voices">
                    {userVoices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.category ? ` (${v.category})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Library (paid plan required)">
                  {libraryVoices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
                <option value={CUSTOM_VOICE_VALUE}>Custom voice ID…</option>
              </Select>
              {voiceId === CUSTOM_VOICE_VALUE && (
                <Input
                  mt={2}
                  size="sm"
                  value={customVoiceId}
                  onChange={(e) => setCustomVoiceId(e.target.value)}
                  placeholder="Paste an ElevenLabs voice ID"
                />
              )}
              <Text fontSize="xs" color="gray.500" mt={1.5}>
                Library voices need a paid ElevenLabs plan via API. Free-tier users:
                pick one of "Your voices" (clone/design at{" "}
                <Link
                  href="https://elevenlabs.io/app/voice-lab"
                  isExternal
                  color="blue.500"
                  textDecoration="underline"
                >
                  Voice Lab
                </Link>
                ).
                {voicesFetchFailed && (
                  <> Voice list couldn't auto-load — using preset library.</>
                )}
              </Text>
            </Box>

            <Text fontSize="xs" color="gray.500" pt={2} borderTop="1px solid" borderColor="gray.100">
              Generation takes 30-60 seconds. We'll notify you when it's ready — feel free to keep working.
            </Text>
          </Flex>
        </ModalBody>

        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button colorScheme="blue" onClick={handleSubmit} leftIcon={<Headphones size={14} />}>
            Generate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
