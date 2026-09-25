import { useEffect, useState } from 'react';
import { Box, Button, Text, useToast } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { RecordingMeters, type RecordingSource } from './RecordingControls';

// The native capture outlives an editor. Keep a stop control available if
// navigation unmounts the component that started it.
const owners = new Set<string>();
export function useRecordingOwner(id: string | null, recording: boolean) {
  useEffect(() => {
    if (!recording || !id) return;
    owners.add(id);
    return () => { owners.delete(id); };
  }, [id, recording]);
}
type Session = { recording_id: string; recording: boolean; can_stop: boolean; use_local: boolean; source: RecordingSource };
export function RecordingRecovery() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await invoke<Session>('get_audio_capture_status');
        if (!disposed) setSession(status.can_stop && !owners.has(status.recording_id) ? status : null);
      } catch { /* A normal browser preview has no native capture. */ }
      if (!disposed) timer = setTimeout(poll, 700);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  if (!session && !busy) return null;
  const stop = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await invoke<string>('stop_audio_recording', { useLocal: session.use_local });
      if (!session.use_local) await invoke('transcribe_audio', { filePath: result });
      toast({ title: 'Transcript saved', description: 'Find the transcript in Settings → Manage recordings.', status: 'success', duration: 6000, isClosable: true, position: 'bottom-right' });
    } catch (e) {
      toast({ title: 'Recording saved; transcription needs attention', description: `${String(e)} Open Settings → Manage recordings to recover the audio.`, status: 'warning', duration: 7000, isClosable: true, position: 'bottom-right' });
    } finally { setBusy(false); setSession(null); }
  };
  return <Box borderWidth="1px" borderColor="red.100" borderRadius="md" p={2} mb={2}>
    <Text fontSize="xs" color="red.600" mb={2}>{session?.recording ? 'Recording continues' : busy ? 'Finishing transcription…' : 'Captured audio is ready to save'}</Text>
    {session && <RecordingMeters recordingId={session.recording_id} source={session.source} />}
    <Button mt={2} size="xs" colorScheme="red" isLoading={busy} loadingText="Saving…" onClick={() => void stop()}>Stop & save transcript</Button>
  </Box>;
}
