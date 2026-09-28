import { type FC, useMemo, useState, useEffect } from "react";
import {
  Box,
  Flex,
  Text,
  HStack,
  VStack,
  IconButton,
  Divider,
  Input,
  InputGroup,
  InputLeftElement,
  Button,
  Spinner,
  Tag,
} from "@chakra-ui/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Search,
  ChevronDown,
  FilePlus,
  FileUp,
  ClipboardPaste,
  Mic,
  Square,
  File,
  Bold,
  Italic,
  List,
  Undo,
  Redo,
  NotebookPen,
  FolderInput,
  MoreHorizontal,
  ArrowDownUp,
} from "lucide-react";
import { useTypewriter } from "../hooks/useTypewriter";

type PreviewState = "note" | "story";

type Document = {
  id: number;
  name: string;
  project: string;
  active?: boolean;
};

const SAMPLE_DOCS: Document[] = [
  { id: 1, name: "Customer interview — Acme Corp", project: "Customer Research", active: true },
  { id: 2, name: "Q2 product strategy review", project: "Product Planning" },
  { id: 3, name: "Architecture decision: vector store", project: "Engineering" },
  { id: 4, name: "Hiring rubric — senior eng", project: "Hiring" },
  { id: 5, name: "Onboarding checklist v3", project: "Operations" },
  { id: 6, name: "Weekly investor update", project: "Fundraising" },
];

const STATIC_NOTE_HTML = `
<h2>Customer interview — Acme Corp</h2>
<p><strong>Attendees:</strong> Maria (Head of Ops), James (Eng Lead), Alex</p>
<h3>Key takeaways</h3>
<ul>
  <li>Their team spends ~6 hours/week reconciling meeting notes across tools</li>
  <li>Privacy is non-negotiable — recordings can't leave the device</li>
  <li>They tried other tools but rejected them for cloud transcription</li>
</ul>
<h3>Action items</h3>
<ul>
  <li>Send technical overview of local Whisper pipeline</li>
  <li>Schedule follow-up with their security team next week</li>
</ul>
`;

const STORY_TITLE = "Product sync — onboarding";

const RAW_TRANSCRIPT =
  "So five of the eight pilot teams got stuck inviting teammates. They thought the invite was sent, but there was still a confirm step. Let's simplify that copy first, before we redesign the whole flow. Alex, can you have the copy ready Thursday? Great. Maya will run QA Friday morning. If that passes, we'll roll it out to the pilot teams Friday afternoon. Otherwise we wait until Monday.";

const LIVE_PREVIEW_PREFIX = "Five of the eight pilot teams got stuck inviting teammates. ";
const LIVE_PREVIEW_STREAM = "Let's simplify the copy before we redesign the whole flow.";

const POLISHED_NOTES_HTML = `
<h3>What we learned</h3>
<ul>
  <li>5 of 8 pilot teams missed the final invite confirmation step.</li>
</ul>
<h3>Decision</h3>
<ul>
  <li>Clarify the invite copy before considering a full redesign.</li>
  <li>Pilot rollout Friday afternoon if QA passes; otherwise Monday.</li>
</ul>
<h3>Next steps</h3>
<ul>
  <li><strong>Alex</strong> — updated invite copy by Thursday.</li>
  <li><strong>Maya</strong> — QA on Friday morning.</li>
</ul>
`;

type Phase = "recording" | "transcribing" | "raw" | "polishing" | "polished";

const PHASE_DURATIONS: Record<Phase, number> = {
  recording: 5000,
  transcribing: 1000,
  raw: 4500,
  polishing: 1200,
  polished: 8000,
};

const PHASE_ORDER: Phase[] = ["recording", "transcribing", "raw", "polishing", "polished"];

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export const AppPreview: FC<{ state?: PreviewState; height?: string | number }> = ({
  state = "story",
  height = "560px",
}) => {
  const isStory = state === "story";
  const docs = useMemo(() => SAMPLE_DOCS.map(doc =>
    isStory && doc.active ? { ...doc, name: STORY_TITLE, project: "Product Planning" } : doc
  ), [isStory]);

  const [phase, setPhase] = useState<Phase>("recording");
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Cycle phases
  useEffect(() => {
    if (!isStory) return;
    const idx = PHASE_ORDER.indexOf(phase);
    const next = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
    const t = setTimeout(() => {
      if (next === "recording") setRecordingSeconds(0);
      setPhase(next);
    }, PHASE_DURATIONS[phase]);
    return () => clearTimeout(t);
  }, [phase, isStory]);

  // Recording timer ticks
  useEffect(() => {
    if (!isStory || phase !== "recording") return;
    const i = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [phase, isStory]);

  const isRecording = isStory && phase === "recording";
  const isTranscribing = isStory && phase === "transcribing";
  const isPolishing = isStory && phase === "polishing";

  const showRaw = isStory && (phase === "raw" || phase === "polishing");
  const showPolished = isStory && phase === "polished";

  // New chunk streams in at normal reading pace; prefix is shown immediately
  const livePreviewStreamed = useTypewriter(LIVE_PREVIEW_STREAM, 55, 600, isRecording);

  let html: string;
  let title: string;
  if (!isStory) {
    html = STATIC_NOTE_HTML;
    title = "Customer interview — Acme Corp";
  } else if (showPolished) {
    html = POLISHED_NOTES_HTML;
    title = STORY_TITLE;
  } else if (showRaw) {
    html = `<h3>Transcript</h3><p>${RAW_TRANSCRIPT}</p>`;
    title = STORY_TITLE;
  } else {
    html = `<p>${
      isTranscribing ? "Transcribing your recording…" : "Listening…"
    }</p>`;
    title = STORY_TITLE;
  }

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: "Start writing..." }),
      ],
      content: html,
      editable: false,
    },
    [html]
  );

  return (
    <Box
      position="relative"
      borderRadius="2xl"
      overflow="hidden"
      boxShadow="0 30px 80px -20px rgba(15, 23, 42, 0.25), 0 10px 30px -10px rgba(15, 23, 42, 0.12)"
      border="1px solid"
      borderColor="ink.200"
      bg="white"
      h={height}
      display="flex"
      flexDirection="column"
    >
      {/* macOS traffic lights — overlaid on the left panel, hidden on mobile (left panel hidden) */}
      <Box position="absolute" top="14px" left="14px" zIndex={2} display={{ base: "none", md: "block" }}>
        <HStack spacing={2}>
          <Box w="12px" h="12px" borderRadius="full" bg="#FF5F57" />
          <Box w="12px" h="12px" borderRadius="full" bg="#FEBC2E" />
          <Box w="12px" h="12px" borderRadius="full" bg="#28C840" />
        </HStack>
      </Box>

      {/* Body */}
      <Flex flex={1} overflow="hidden">
        {/* LEFT PANEL — hidden on mobile (story flow happens entirely in editor pane) */}
        <Box
          w="320px"
          borderRight="1px solid"
          borderColor="ink.200"
          display={{ base: "none", md: "flex" }}
          flexDirection="column"
          pt={12}
          px={4}
          pb={4}
          gap={3}
        >
          {/* Project selector */}
          <Flex
            align="center"
            justify="space-between"
            px={3}
            py={2}
            border="1px solid"
            borderColor="ink.200"
            borderRadius="md"
            bg="white"
            cursor="pointer"
            _hover={{ bg: "ink.50", borderColor: "ink.300" }}
          >
            <Text fontSize="sm" fontWeight="600" color="ink.800">
              All projects
            </Text>
            <HStack spacing={1}>
              <ChevronDown size={14} color="#A1A1AA" />
            </HStack>
          </Flex>

          {/* Section heading + actions */}
          <Flex justify="space-between" align="center" mt={2}>
            <Text fontSize="sm" fontWeight="700" color="ink.800" letterSpacing="-0.01em">
              Notes
            </Text>
            <HStack spacing={0}>
              <IconButton aria-label="New note" icon={<FilePlus size={14} />} size="xs" variant="ghost" />
              <IconButton aria-label="Import file" icon={<FileUp size={14} />} size="xs" variant="ghost" />
              <IconButton aria-label="Paste" icon={<ClipboardPaste size={14} />} size="xs" variant="ghost" />
            </HStack>
          </Flex>

          {/* Pill search */}
          <InputGroup size="sm">
            <InputLeftElement pointerEvents="none">
              <Search size={13} color="#A1A1AA" />
            </InputLeftElement>
            <Input
              placeholder="Search notes & content…"
              borderRadius="full"
              fontSize="xs"
              borderColor="ink.200"
              _focus={{ boxShadow: "0 0 0 1px var(--chakra-colors-teal-400)", borderColor: "teal.400" }}
            />
          </InputGroup>

          <Flex align="center" justify="space-between">
            <Text fontSize="xs" color="ink.500">{docs.length} notes</Text>
            <IconButton aria-label="Sort notes" icon={<ArrowDownUp size={14} />} size="xs" variant="ghost" color="ink.500" />
          </Flex>

          {/* Document rows — match real app: flat, hover-only, left border for active */}
          <Box flex={1} overflowY="auto" mx={-2} mt={1}>
            {docs.map((doc) => (
              <Flex
                key={doc.id}
                p={3}
                mb={0.5}
                borderRadius="md"
                align="center"
                justify="space-between"
                bg="transparent"
                _before={doc.active ? { content: '""', position: "absolute", left: 0, top: "12px", w: "2px", h: "22px", bg: "#91B5AE", borderRadius: "full" } : undefined}
                cursor="pointer"
                _hover={{ bg: "ink.50" }}
                position="relative"
                minH="55px"
                role="group"
                transition="background 0.15s"
              >
                <Flex align="center" gap={3} flex={1} minW={0}>
                  <Box color="ink.500" flexShrink={0}>
                    <File size={15} />
                  </Box>
                  <Box flex={1} minW={0}>
                    <Text
                      fontSize="sm"
                      color="ink.800"
                      fontWeight={doc.active ? "500" : "400"}
                      noOfLines={2}
                      lineHeight={1.35}
                      pr="60px"
                    >
                      {doc.name}
                    </Text>
                    <Tag
                      position="absolute"
                      bottom="6px"
                      right="8px"
                      fontSize="10px"
                      px={2}
                      py={0.5}
                      borderRadius="full"
                      bg="ink.100"
                      color="ink.600"
                    >
                      {doc.project}
                    </Tag>
                  </Box>
                </Flex>
                <Box position="absolute" top="8px" right="8px" opacity={0} _groupHover={{ opacity: 1 }}>
                  <MoreHorizontal size={13} color="#A1A1AA" />
                </Box>
              </Flex>
            ))}
          </Box>
        </Box>

        {/* EDITOR */}
        <Box flex={1} display="flex" flexDirection="column" bg="white" overflow="hidden">
          {/* Title row */}
          <Flex px={{ base: 4, md: 6 }} pt={{ base: 4, md: 5 }} pb={3} align="center" gap={1}>
            <Text
              fontSize={{ base: "md", md: "2xl" }}
              fontWeight="700"
              letterSpacing="-0.02em"
              color="ink.900"
              flex={1}
              noOfLines={1}
            >
              {title}
            </Text>
            <IconButton
              aria-label="Record"
              icon={isRecording ? <Square size={15} /> : <Mic size={15} />}
              size="sm"
              variant="ghost"
              color="ink.700"
              isDisabled={isTranscribing || isPolishing}
            />
            <IconButton
              aria-label={isStory ? "Organize meeting notes" : "Clean up note"}
              icon={isPolishing ? <Spinner size="xs" /> : <NotebookPen size={15} />}
              size="sm"
              variant="ghost"
              color="ink.700"
              isDisabled={isStory && !showRaw || isPolishing}
              onClick={() => { if (showRaw) setPhase("polishing"); }}
            />
            <IconButton aria-label="Move" icon={<FolderInput size={15} />} size="sm" variant="ghost" color="ink.700" />
          </Flex>

          {/* Formatting toolbar — hidden on small mobile to save space */}
          <Flex px={{ base: 4, md: 6 }} pb={3} align="center" gap={1.5} display={{ base: "none", sm: "flex" }}>
            <IconButton aria-label="Bold" icon={<Bold size={13} />} size="xs" variant="outline" borderColor="ink.200" color="ink.700" />
            <IconButton aria-label="Italic" icon={<Italic size={13} />} size="xs" variant="outline" borderColor="ink.200" color="ink.700" />
            <IconButton aria-label="List" icon={<List size={13} />} size="xs" variant="outline" borderColor="ink.200" color="ink.700" />
            <IconButton aria-label="Undo" icon={<Undo size={13} />} size="xs" variant="outline" borderColor="ink.200" color="ink.700" />
            <IconButton aria-label="Redo" icon={<Redo size={13} />} size="xs" variant="outline" borderColor="ink.200" color="ink.700" />
            <Box
              ml={2}
              border="1px solid"
              borderColor="ink.200"
              borderRadius="md"
              px={2}
              py={1}
              fontSize="xs"
              color="ink.700"
              display="flex"
              alignItems="center"
              gap={1}
            >
              Inter <ChevronDown size={11} />
            </Box>
          </Flex>

          {/* Editor body */}
          <Box flex={1} overflowY="auto" px={{ base: 4, md: 6 }} pb={4}>
            <Box
              sx={{
                "& h2": {
                  fontSize: "lg",
                  fontWeight: "700",
                  letterSpacing: "-0.01em",
                  mb: 2,
                  mt: 2,
                  color: "ink.900",
                },
                "& h3": {
                  fontSize: "md",
                  fontWeight: "600",
                  mb: 2,
                  mt: 4,
                  color: "ink.800",
                },
                "& p": {
                  fontSize: "sm",
                  color: "ink.700",
                  mb: 2,
                  lineHeight: 1.65,
                },
                "& p.muted": { color: "ink.400", fontStyle: "italic" },
                "& ul": { pl: 5, mb: 3 },
                "& li": { fontSize: "sm", color: "ink.700", mb: 1, lineHeight: 1.65 },
                "& strong": { color: "ink.900", fontWeight: "600" },
                "& .ProseMirror": { outline: "none" },
                "& .ProseMirror:focus": { outline: "none" },
                "& .cursor": {
                  display: "inline-block",
                  width: "0.55em",
                  marginLeft: "1px",
                  color: "teal.500",
                  animation: "blink 1s steps(2) infinite",
                },
                "@keyframes blink": {
                  "0%, 50%": { opacity: 1 },
                  "51%, 100%": { opacity: 0 },
                },
              }}
            >
              <EditorContent editor={editor} />

              {isPolishing && (
                <Flex
                  align="center"
                  gap={2}
                  mt={4}
                  px={3}
                  py={2}
                  bg="ink.50"
                  borderRadius="md"
                  w="fit-content"
                >
                  <Spinner size="xs" color="ink.500" />
                  <Text fontSize="xs" color="ink.700" fontWeight="500">
                    Organizing meeting notes…
                  </Text>
                </Flex>
              )}
            </Box>
          </Box>

          {/* Inline recording / transcribing status */}
          {(isRecording || isTranscribing) && (
            <Box px={{ base: 4, md: 6 }} pb={5}>
              <Flex
                px={3}
                py={2}
                bg={isRecording ? "red.50" : "blue.50"}
                borderRadius="md"
                align="center"
                gap={2}
              >
                {isRecording && (
                  <>
                    <Box
                      w="8px"
                      h="8px"
                      borderRadius="full"
                      bg="red.500"
                      sx={{
                        animation: "pulse 1.5s ease-in-out infinite",
                        "@keyframes pulse": {
                          "0%, 100%": { opacity: 1 },
                          "50%": { opacity: 0.3 },
                        },
                      }}
                    />
                    <Text fontSize="xs" fontWeight="500" color="red.600" flex={1}>
                      Recording {formatTime(recordingSeconds)}
                    </Text>
                    <Button
                      size="xs"
                      borderRadius="full"
                      bg="ink.900"
                      color="white"
                      _hover={{ bg: "ink.800" }}
                      px={3}
                      onClick={() => setPhase("transcribing")}
                    >
                      Stop recording
                    </Button>
                  </>
                )}
                {isTranscribing && (
                  <>
                    <Spinner size="xs" color="blue.500" />
                    <Text fontSize="xs" fontWeight="500" color="blue.600">
                      Transcribing locally…
                    </Text>
                  </>
                )}
              </Flex>
              {isRecording && (
                <Box
                  mt={1.5}
                  px={3}
                  py={2}
                  bg="ink.50"
                  borderRadius="md"
                  maxH="84px"
                  overflow="hidden"
                  border="1px solid"
                  borderColor="ink.100"
                >
                  <Text fontSize="10px" color="ink.500" mb={0.5}>Live draft</Text>
                  <Text fontSize="xs" color="ink.600" fontStyle="italic" lineHeight={1.5} noOfLines={2}>
                    {LIVE_PREVIEW_PREFIX}{livePreviewStreamed}
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
};
