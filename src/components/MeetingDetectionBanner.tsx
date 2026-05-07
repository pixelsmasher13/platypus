import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { Box, Flex, Text, Button, CloseButton } from "@chakra-ui/react";
import { Mic } from "lucide-react";

const AUTO_DISMISS_MS = 30_000; // 30 seconds

const shortenAppName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().startsWith("microsoft ")) {
    return trimmed.slice("Microsoft ".length);
  }
  return trimmed;
};

export const MeetingDetectionBanner = () => {
  const [meetingApp, setMeetingApp] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlistenDetected = listen<string>("meeting-detected", async (event) => {
      setMeetingApp(event.payload);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setMeetingApp(null);
      }, AUTO_DISMISS_MS);
    });

    // Dismiss the banner whenever recording is toggled — fired by the
    // floating popup's "Start notes" button, the system-tray menu, and
    // our own button below. Single source of truth means the banner
    // disappears the moment recording starts, regardless of trigger.
    const unlistenToggle = listen("toggle_recording", () => {
      setMeetingApp(null);
      if (timerRef.current) clearTimeout(timerRef.current);
    });

    return () => {
      unlistenDetected.then((f) => f());
      unlistenToggle.then((f) => f());
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!meetingApp) return null;

  const dismissBanner = () => {
    setMeetingApp(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleStartRecording = () => {
    appWindow.emit("toggle_recording", { data: true });
    // The toggle_recording listener above will clear meetingApp; the
    // explicit dismiss here is just defensive in case the event-loop
    // round-trip is delayed.
    dismissBanner();
  };

  return (
    <Box
      bg="teal.500"
      color="white"
      px={4}
      py={2}
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={9999}
    >
      <Flex align="center" justify="center" gap={4}>
        <Mic size={16} />
        <Text fontWeight="bold" fontSize="sm">
          {shortenAppName(meetingApp)} meeting detected
        </Text>
        <Button
          size="sm"
          colorScheme="whiteAlpha"
          variant="solid"
          onClick={handleStartRecording}
        >
          Start notes
        </Button>
        <CloseButton size="sm" onClick={dismissBanner} />
      </Flex>
    </Box>
  );
};
