import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { Box, Flex, Text, Button, CloseButton } from "@chakra-ui/react";
import { Mic } from "lucide-react";

const AUTO_DISMISS_MS = 30_000; // 30 seconds

export const MeetingDetectionBanner = () => {
  const [meetingApp, setMeetingApp] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("meeting-detected", async (event) => {
      setMeetingApp(event.payload);

      console.log("[MeetingDetection] Event received:", event.payload);

      // Bring Platypus to the front — macOS prevents focus stealing,
      // so we set always-on-top until the user interacts with the banner.
      try {
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setAlwaysOnTop(true);
        await appWindow.setFocus();
      } catch (e) {
        console.error("Failed to focus window:", e);
      }

      // Auto-dismiss after 30s (also releases always-on-top)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setMeetingApp(null);
        appWindow.setAlwaysOnTop(false).catch(() => {});
      }, AUTO_DISMISS_MS);
    });

    return () => {
      unlisten.then((f) => f());
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!meetingApp) return null;

  const dismissBanner = () => {
    setMeetingApp(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    appWindow.setAlwaysOnTop(false).catch(() => {});
  };

  const handleStartRecording = () => {
    // Emit the same event the system tray uses to toggle recording
    appWindow.emit("toggle_recording", { data: true });
    dismissBanner();
  };

  const handleDismiss = () => {
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
          {meetingApp} meeting detected
        </Text>
        <Button
          size="sm"
          colorScheme="whiteAlpha"
          variant="solid"
          onClick={handleStartRecording}
        >
          Start Recording
        </Button>
        <CloseButton size="sm" onClick={handleDismiss} />
      </Flex>
    </Box>
  );
};
