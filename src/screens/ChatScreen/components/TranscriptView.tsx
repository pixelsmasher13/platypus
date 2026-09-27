import { useEffect, useState, useId } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Box, Button, Flex, Text, Input, FormControl, FormLabel } from '@chakra-ui/react';
import { sourceLabel } from '../meetingSources';
import { Play } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';

type Recording = { id: string; audio_available: boolean; transcript: string | null };
export function TranscriptView({ node, extension, editor, getPos }: NodeViewProps) {
  const labelId = useId();
  const [audio, setAudio] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [editingLabels, setEditingLabels] = useState(false);
  const [labels, setLabels] = useState({ microphone: 'You', system: 'Remote participants' });
  const sources = new Set<string>();
  node.descendants(child => { if (child.type.name === 'speakerTurn') sources.add(child.attrs.source); });
  const editLabels = () => {
    const current = { microphone: 'You', system: 'Remote participants' };
    node.descendants(child => {
      if (child.type.name === 'speakerTurn' && (child.attrs.source === 'microphone' || child.attrs.source === 'system')) {
        current[child.attrs.source as keyof typeof current] = child.attrs.label || sourceLabel(child.attrs.source);
      }
    });
    setLabels(current); setEditingLabels(true);
  };
  const saveLabels = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const transaction = editor.state.tr;
    node.descendants((child, offset) => {
      if (child.type.name !== 'speakerTurn') return;
      const label = labels[child.attrs.source as keyof typeof labels]?.trim() || sourceLabel(child.attrs.source);
      transaction.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, label });
    });
    editor.view.dispatch(transaction);
    setEditingLabels(false);
  };
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
        <Flex gap={1}>
        {sources.size > 0 && editor.isEditable && <Button size="xs" variant="ghost" onClick={editLabels}>Edit labels</Button>}
        {audio && <Button size="xs" variant="ghost" leftIcon={<Play size={12} />} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide recording' : 'Play recording'}</Button>}
        </Flex>
      </Flex>
      {editingLabels && <Box mt={2} p={3} borderWidth="1px" borderRadius="md" bg="white">
        <Text fontSize="xs" color="gray.500" mb={3}>Labels identify audio sources. Everyone on the remote channel shares one label; your microphone may also pick up people in the room.</Text>
        {(['microphone', 'system'] as const).filter(source => sources.has(source)).map(source => <FormControl key={source} mb={2}>
          <FormLabel fontSize="xs" htmlFor={`${labelId}-${source}`}>{source === 'microphone' ? 'Microphone' : 'Meeting audio'}</FormLabel>
          <Input id={`${labelId}-${source}`} size="sm" maxLength={60} value={labels[source]} onChange={event => setLabels(previous => ({ ...previous, [source]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveLabels(); } if (event.key === 'Escape') setEditingLabels(false); }} />
        </FormControl>)}
        <Flex gap={2} mt={3}><Button size="xs" onClick={saveLabels}>Save labels</Button><Button size="xs" variant="ghost" onClick={() => setEditingLabels(false)}>Cancel</Button></Flex>
      </Box>}
      {expanded && audio && <audio controls autoPlay preload="metadata" src={audio} style={{ width: '100%', marginTop: 8 }} onError={() => setError('This recording could not be played. You can export it in Settings → Manage recordings.')} />}
      {error && <Text role="alert" fontSize="xs" color="red.600">{error}</Text>}
    </Box>
    <NodeViewContent />
  </NodeViewWrapper>;
}
