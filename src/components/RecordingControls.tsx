import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, Box, Button, HStack, IconButton, Menu, MenuButton, MenuItemOption, MenuList, MenuOptionGroup, Progress, Text, VStack } from '@chakra-ui/react';
import { ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

export type RecordingSource = 'both' | 'microphone' | 'system';
const isMac = /Mac/.test(navigator.platform);
export const defaultRecordingSource: RecordingSource = isMac ? 'both' : 'microphone';
const sourceNames: Record<RecordingSource, string> = { both: 'Mic + meeting audio', microphone: 'Microphone only', system: 'Meeting audio only' };
export function RecordingSourcePicker({ value, onChange, disabled }: { value: RecordingSource; onChange: (value: RecordingSource) => void; disabled?: boolean }) {
  if (!isMac) return null;
  return <Menu>
    <MenuButton as={IconButton} size="sm" variant="ghost" icon={<ChevronDown size={14} />} isDisabled={disabled} aria-label="Recording options" title="Recording options" />
    <MenuList fontSize="sm">
      <MenuOptionGroup title="Audio source" type="radio" value={value} onChange={source => onChange(source as RecordingSource)}>
        {(['both', 'microphone', 'system'] as const).map(source => <MenuItemOption key={source} value={source}>{sourceNames[source]}</MenuItemOption>)}
      </MenuOptionGroup>
    </MenuList>
  </Menu>;
}

// Screen & System Audio Recording has no in-app Allow button: macOS sends the user to
// System Settings and applies the grant after Platypus relaunches. Ask early and keep
// the state visible so Record never fails in the middle of a meeting.
export const needsMeetingAudio = (source: RecordingSource) => isMac && source !== 'microphone';
export function useMeetingAudioPermission() {
  const [granted, setGranted] = useState<boolean | null>(isMac ? null : true);
  const refresh = useCallback(async () => {
    if (!isMac) return true;
    try { const value = await invoke<boolean>('meeting_audio_permission'); setGranted(value); return value; } catch { return false; }
  }, []);
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  const request = useCallback(async () => {
    if (!isMac) return true;
    try { const value = await invoke<boolean>('request_meeting_audio_permission'); setGranted(value); return value; } catch { return false; }
  }, []);
  const openSettings = useCallback(() => invoke('open_meeting_audio_settings').catch(() => {}), []);
  const restart = useCallback(() => invoke('restart_app').catch(() => {}), []);
  // The system prompt appears once per install; afterwards System Settings is the only path.
  const allow = useCallback(async () => { if (!(await request())) await openSettings(); }, [request, openSettings]);
  return { granted, refresh, request, allow, openSettings, restart };
}
export function MeetingAudioPermissionNotice({ source }: { source: RecordingSource }) {
  const { granted, allow, restart } = useMeetingAudioPermission();
  if (!needsMeetingAudio(source) || granted !== false) return null;
  return <Alert status="info" variant="subtle" borderRadius="md" fontSize="xs" py={2} px={3} mt={2} flexDirection="column" alignItems="flex-start" gap={1.5}>
    <AlertDescription>Meeting audio needs a one-time macOS permission. Allow Platypus under <b>Screen &amp; System Audio Recording</b>, then restart Platypus. Nothing on screen is recorded. Microphone-only recording works now.</AlertDescription>
    <HStack spacing={2}>
      <Button size="xs" colorScheme="teal" onClick={allow}>Allow meeting audio</Button>
      <Button size="xs" variant="ghost" onClick={restart}>Restart Platypus</Button>
    </HStack>
  </Alert>;
}

type CaptureStatus = { recording_id: string; recording: boolean; microphone: string; meeting_audio: string; microphone_level: number; meeting_level: number; warning: string | null };
export function RecordingMeters({ recordingId, source }: { recordingId: string | null; source: RecordingSource }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await invoke<CaptureStatus>('get_audio_capture_status');
        if (!disposed && value.recording_id === recordingId) { setStatus(value); setError(''); }
      } catch { if (!disposed) setError('Audio status unavailable.'); }
      if (!disposed) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [recordingId]);
  return <VStack align="stretch" spacing={1.5} mt={2} px={2}>
    {source !== 'system' && <AudioMeter label="Microphone" level={status?.microphone_level ?? 0} detail={status?.microphone ?? 'Connecting…'} />}
    {source !== 'microphone' && <AudioMeter label="Meeting audio" level={status?.meeting_level ?? 0} detail={status?.meeting_audio ?? 'Connecting…'} />}
    {(status?.warning || error || status && !status.recording) && <Text role="alert" fontSize="xs" color="orange.700">{status?.warning || error || 'Capture stopped. Press Stop to finish and save the transcript.'}</Text>}
    {source === 'both' && <Text fontSize="xs" color="gray.500">Use headphones for the clearest result without speaker echo.</Text>}
  </VStack>;
}
function AudioMeter({ label, detail, level }: { label: string; detail: string; level: number }) {
  const percent = level > 0 ? Math.max(0, Math.min(100, (20 * Math.log10(level) + 60) / 60 * 100)) : 0;
  return <Box>
    <HStack justify="space-between" spacing={2} mb={0.5}><Text fontSize="xs" flexShrink={0}>{label}</Text><Text fontSize="xs" color="gray.500" noOfLines={1} title={detail}>{detail}</Text></HStack>
    <Progress aria-label={`${label} level`} value={percent} height="3px" borderRadius="full" colorScheme="teal" bg="gray.100" />
  </Box>;
}
