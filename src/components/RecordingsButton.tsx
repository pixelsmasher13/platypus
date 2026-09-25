import { useEffect, useRef, useState } from 'react';
import { Box, Button, HStack, IconButton, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Select, Text, Textarea, VStack, useDisclosure, useToast } from '@chakra-ui/react';
import { AudioLines } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';

type TranscriptVersion = { id: string; model: string; created_at: string; text: string };
type Recording = { id: string; note_id: number | null; created_at: string; duration_seconds: number; source: string; transcription_model: string; status: string; warning: string | null; transcript: string | null; audio_available: boolean };
export function RecordingsButton({ noteId, onInsert, compact = false }: { compact?: boolean; noteId?: number; onInsert?: (text: string) => void }) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [audio, setAudio] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const viewRef = useRef(0);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [versions, setVersions] = useState<TranscriptVersion[]>([]);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    viewRef.current += 1;
    if (!isOpen) return;
    let disposed = false;
    setLoading(true); setError(''); setSelected(null); setAudio(''); setDraft(null); setSelectedVersion('');
    invoke<Recording[]>('list_recordings', { noteId: noteId ?? null }).then(rows => { if (!disposed) setRecordings(rows); }).catch(e => { if (!disposed) setError(String(e)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [isOpen, noteId]);
  useEffect(() => {
    if (!selected || !isOpen) return;
    let disposed = false;
    viewRef.current += 1;
    setAudio('');
    if (selected.audio_available) invoke<string>('recording_audio_path', { id: selected.id }).then(path => { if (!disposed) setAudio(convertFileSrc(path)); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [selected, isOpen]);
  useEffect(() => {
    if (!selected || !isOpen) return;
    let disposed = false;
    setVersions([]);
    invoke<TranscriptVersion[]>('list_recording_transcripts', { id: selected.id }).then(rows => { if (!disposed) setVersions(rows); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [selected, isOpen, revision]);
  const retranscribe = async () => {
    if (!selected) return;
    const view = viewRef.current;
    setBusy(true); setError(''); setDraft(null); setSelectedVersion('');
    toast({ title: 'Transcribing locally', description: 'You can close this panel. The new transcript will be saved with the recording.', status: 'info', position: 'bottom-right', duration: 5000, isClosable: true });
    try {
      if (!await invoke<boolean>('check_whisper_model')) await invoke('download_whisper_model');
      const text = await invoke<string>('retranscribe_recording', { id: selected.id });
      if (viewRef.current === view) setDraft(text);
      const rows = await invoke<Recording[]>('list_recordings', { noteId: noteId ?? null });
      if (viewRef.current === view) {
        setRecordings(rows);
        const updated = rows.find(row => row.id === selected.id);
        if (updated && !updated.audio_available) { setAudio(''); setSelected(updated); }
      }
      setRevision(value => value + 1);
      toast({ title: 'New transcription saved', description: 'Find it in Settings → Manage recordings → Previous transcriptions.', status: 'success', position: 'bottom-right', duration: 6000, isClosable: true });
    } catch (e) { if (viewRef.current === view) setError(String(e)); toast({ title: 'Transcription failed', description: String(e), status: 'error', position: 'bottom-right', duration: 6000, isClosable: true }); } finally { setBusy(false); }
  };
  const exportAudio = async (isolated: boolean) => {
    if (!selected) return;
    try { await invoke('export_recording', { id: selected.id, isolated }); } catch (e) { setError(String(e)); }
  };
  return <>
    <>{compact ? <IconButton size="sm" variant="ghost" icon={<AudioLines size={16} />} aria-label="Note recordings" title="Note recordings" onClick={onOpen} /> : <Button size="xs" variant="ghost" leftIcon={<AudioLines size={14} />} onClick={onOpen}>Manage recordings</Button>}</>
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay /><ModalContent><ModalHeader>{noteId ? 'Note recordings' : 'Recordings & recovery'}</ModalHeader><ModalCloseButton />
        <ModalBody pb={6}>
          <Text color="gray.500" fontSize="sm" mb={4}>Saved audio and recoverable transcripts live on this computer. Audio is kept only when requested or when transcription needs attention.</Text>
          {error && <Text role="alert" color="red.600" fontSize="sm" mb={3}>{error}</Text>}
          {loading ? <Text color="gray.500">Loading recordings…</Text> : recordings.length === 0 ? <Text color="gray.500">No saved sessions yet. Enable Keep recordings to save audio from future meetings.</Text> : <VStack align="stretch" spacing={2}>
            {recordings.map(recording => <Button key={recording.id} variant="outline" height="auto" py={3} whiteSpace="normal" justifyContent="flex-start" textAlign="left" borderColor={selected?.id === recording.id ? 'teal.400' : 'gray.200'} isDisabled={recording.status === 'recording'} onClick={() => { setSelected(recording); setDraft(null); setSelectedVersion(''); setError(''); }}>
              <Box><Text fontSize="sm">{new Date(recording.created_at).toLocaleString()}</Text><Text fontSize="xs" color="gray.500" fontWeight="normal" mt={1}>{Math.floor(recording.duration_seconds / 60)}:{Math.floor(recording.duration_seconds % 60).toString().padStart(2, '0')} · {recording.source === 'both' ? 'Mic + meeting' : recording.source === 'system' ? 'Meeting audio' : 'Microphone'} · {recording.transcription_model || 'Local Whisper'}{recording.status === 'recording' ? ' · Recording…' : recording.audio_available ? ' · Audio available' : ' · Transcript only'}{!noteId && recording.note_id ? ` · Note #${recording.note_id}` : ''}</Text></Box>
            </Button>)}
          </VStack>}
          {selected && <Box mt={5} borderTopWidth="1px" pt={4}>
            {selected.warning && <Text color="orange.700" fontSize="sm" mb={3}>{selected.warning}</Text>}
            {audio && <audio key={audio} controls preload="metadata" src={audio} style={{ width: '100%' }} onError={() => setError('Could not play this recording. Try exporting the WAV file.')} />}
            {selected.audio_available && <HStack mt={3} flexWrap="wrap">
              <Button size="sm" onClick={() => void exportAudio(false)}>Export audio</Button>
              <Button size="sm" variant="ghost" onClick={() => void exportAudio(true)}>Export separate sources</Button>
              <Button size="sm" colorScheme="teal" variant="outline" isLoading={busy} loadingText="Transcribing locally…" isDisabled={selected.status === 'failed'} onClick={() => void retranscribe()}>Retranscribe locally</Button>
            </HStack>}
            {selected.audio_available && <Text fontSize="xs" color="gray.500" mt={2}>Separate sources: microphone on the left, meeting audio on the right. A new transcription keeps the original unchanged.</Text>}
            {selected.transcript && <Box mt={4}><Text fontSize="xs" fontWeight="semibold" mb={1}>Original transcript</Text><Box maxH="160px" overflowY="auto"><Text fontSize="sm" whiteSpace="pre-wrap">{selected.transcript}</Text></Box><Button size="xs" mt={2} variant="ghost" onClick={() => void navigator.clipboard.writeText(selected.transcript!).then(() => toast({ title: 'Transcript copied', status: 'success', duration: 2000 })).catch(e => setError(String(e)))}>Copy transcript</Button>{onInsert && <Button size="xs" mt={2} variant="outline" onClick={() => { onInsert(selected.transcript!); onClose(); }}>Add original transcript to note</Button>}</Box>}
            {versions.length > 0 && <Box mt={4}><Text fontSize="xs" fontWeight="semibold" mb={1}>Previous transcriptions</Text><Select size="sm" aria-label="Previous transcriptions" placeholder="Choose a saved comparison" value={selectedVersion} onChange={event => { setSelectedVersion(event.target.value); const version = versions.find(item => item.id === event.target.value); if (version) setDraft(version.text); }}>{versions.map(version => <option key={version.id} value={version.id}>{version.model || 'Local Whisper'} · {new Date(version.created_at).toLocaleString()}</option>)}</Select></Box>}
            {draft !== null && <Box mt={4}><Text fontSize="sm" fontWeight="semibold" mb={2}>New transcription</Text><Textarea value={draft} onChange={e => setDraft(e.target.value)} minH="180px" />{!draft && <Text color="gray.500" fontSize="xs">No speech detected.</Text>}{onInsert && <Button size="sm" mt={2} isDisabled={!draft.trim()} onClick={() => { onInsert(draft); onClose(); }}>Add to note</Button>}</Box>}
          </Box>}
        </ModalBody>
      </ModalContent>
    </Modal>
  </>;
}
