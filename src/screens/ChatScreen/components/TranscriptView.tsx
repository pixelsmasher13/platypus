import { useEffect, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Play } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';

type Recording = { id: string; audio_available: boolean; transcript: string | null };
export function TranscriptView({ node, extension }: NodeViewProps) {
  const [audio, setAudio] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const recordingId = node.attrs.recordingId as string | null;
  const noteId = extension.options.getNoteId?.() as number | undefined;
  const text = recordingId ? '' : node.textBetween(0, node.content.size, '\n');
  useEffect(() => {
    let disposed = false;
    setAudio(''); setExpanded(false); setError('');
    const load = async () => {
      let id = recordingId;
      if (!id && noteId) {
        // Older transcript blocks have no recording ID. Only offer playback
        // for an exact transcript match so we cannot play a different meeting.
        const rows = await invoke<Recording[]>('list_recordings', { noteId });
        const matches = rows.filter(row => row.audio_available && row.transcript?.trim() === text.trim());
        if (matches.length === 1) id = matches[0].id;
      }
      if (!id) return;
      const path = await invoke<string>('recording_audio_path', { id });
      if (!disposed) setAudio(convertFileSrc(path));
    };
    void load().catch(() => { /* Audio retention is optional. */ });
    return () => { disposed = true; };
  }, [recordingId, noteId, text]);
  return <NodeViewWrapper as="section" data-transcript="true" role="region" aria-label="Meeting transcript">
    <Box contentEditable={false} mb={2}>
      <Flex align="center" justify="space-between" gap={3}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.500">Transcript</Text>
        {audio && <Button size="xs" variant="ghost" leftIcon={<Play size={12} />} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide recording' : 'Play recording'}</Button>}
      </Flex>
      {expanded && audio && <audio controls autoPlay preload="metadata" src={audio} style={{ width: '100%', marginTop: 8 }} onError={() => setError('This recording could not be played. You can export it in Settings → Manage recordings.')} />}
      {error && <Text role="alert" fontSize="xs" color="red.600">{error}</Text>}
    </Box>
    <NodeViewContent />
  </NodeViewWrapper>;
}
