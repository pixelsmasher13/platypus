import { useState } from 'react';
import { Alert, AlertIcon, Button, FormControl, FormLabel, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import type { MeetingSources } from '../meetingSources';

export function MeetingSourcesModal({ initial, onClose, onGenerate }: {
  initial: MeetingSources;
  onClose: () => void;
  onGenerate: (sources: MeetingSources) => void;
}) {
  const [sources, setSources] = useState(initial);
  const hasNotes = !!sources.notes.trim();
  const hasTranscript = !!sources.transcript.trim();
  return <Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside" closeOnOverlayClick={false}>
    <ModalOverlay /><ModalContent>
      <ModalHeader pb={2}>Organize meeting notes</ModalHeader><ModalCloseButton />
      <ModalBody>
        <Text fontSize="sm" color="gray.600" mb={5}>Turn your rough notes and transcript into clear meeting notes, with key details and next steps.</Text>
        <FormControl mb={5}>
          <FormLabel fontSize="sm">Your rough notes</FormLabel>
          <Textarea aria-label="Your rough notes" value={sources.notes} minH="140px" placeholder="The points you cared about, questions, or quick bullets…" onChange={event => setSources({ ...sources, notes: event.target.value })} />
        </FormControl>
        <FormControl mb={4}>
          <FormLabel fontSize="sm">Meeting transcript</FormLabel>
          <Textarea aria-label="Meeting transcript" value={sources.transcript} minH="200px" placeholder="Record into this note, or paste a transcript here…" onChange={event => setSources({ ...sources, transcript: event.target.value })} />
        </FormControl>
        {!hasTranscript && <Alert status="info" fontSize="sm" borderRadius="md"><AlertIcon />Without a transcript, the draft can only use the details in your notes. If this is an older transcript-only note, move its text into the transcript field.</Alert>}
        {!hasNotes && hasTranscript && <Text fontSize="sm" color="gray.600">No rough notes yet. We’ll organize the important points from the transcript.</Text>}
      </ModalBody>
      <ModalFooter gap={2}><Button variant="ghost" onClick={onClose}>Cancel</Button><Button colorScheme="teal" isDisabled={!hasNotes && !hasTranscript} onClick={() => onGenerate(sources)}>Organize meeting notes</Button></ModalFooter>
    </ModalContent>
  </Modal>;
}
