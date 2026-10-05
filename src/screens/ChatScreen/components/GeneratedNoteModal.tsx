import type { GeneratedNoteDraft } from "../meetingRecapJobs";
import { useState } from 'react';
import { Box, Button, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea, useToast } from '@chakra-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  draft: GeneratedNoteDraft | null;
  onChange: (draft: GeneratedNoteDraft) => void;
  onClose: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void>;
};

export function GeneratedNoteModal({ draft, onChange, onClose, onDiscard, onSave }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try { await onSave(); }
    catch (error) { toast({ title: 'Could not save the meeting recap', description: String(error), status: 'error', isClosable: true }); }
    finally { setIsSaving(false); }
  };
  return <Modal isOpen={!!draft} onClose={onClose} size="3xl" scrollBehavior="inside" closeOnOverlayClick={false} closeOnEsc={!isSaving}>
    <ModalOverlay />
    <ModalContent>
      <ModalHeader>Review meeting notes</ModalHeader>
      <ModalCloseButton isDisabled={isSaving} />
      <ModalBody>
        <Text fontSize="sm" color="gray.600" mb={4}>This will replace the current content of {draft?.sourceTitle}, including edits made during generation. Review it first. The transcript stays available underneath the summary.</Text>
        {draft && <>
          <Input aria-label="Meeting recap title" value={draft.title} isDisabled={isSaving} mb={4} onChange={event => onChange({ ...draft, title: event.target.value })} />
          <Tabs colorScheme="teal" isLazy>
            <TabList><Tab>Preview</Tab><Tab>Edit</Tab>{draft.sources && <Tab>Sources</Tab>}</TabList>
            <TabPanels>
              <TabPanel px={0}><Box fontSize="sm" lineHeight="1.8" sx={{ 'h2': { fontSize: 'lg', fontWeight: 600, mt: 5, mb: 2 }, 'ul, ol': { pl: 6 }, p: { mb: 3 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.markdown}</ReactMarkdown></Box></TabPanel>
              <TabPanel px={0}><Textarea aria-label="Meeting recap draft" value={draft.markdown} isDisabled={isSaving} minH="360px" fontSize="sm" onChange={event => onChange({ ...draft, markdown: event.target.value })} /></TabPanel>
              {draft.sources && <TabPanel px={0}>
                <Text fontSize="sm" fontWeight="600" mb={2}>Your rough notes</Text>
                <Text fontSize="sm" whiteSpace="pre-wrap" mb={5}>{draft.sources.notes || 'No rough notes provided.'}</Text>
                <Text fontSize="sm" fontWeight="600" mb={2}>Meeting transcript</Text>
                <Text fontSize="sm" whiteSpace="pre-wrap">{draft.sources.transcript || 'No transcript provided.'}</Text>
              </TabPanel>}
            </TabPanels>
          </Tabs>
        </>}
      </ModalBody>
      <ModalFooter gap={2}>
        <Button variant="ghost" onClick={onDiscard} isDisabled={isSaving}>Discard draft</Button>
        <Button variant="ghost" onClick={onClose} isDisabled={isSaving}>Review later</Button>
        <Button colorScheme="teal" onClick={() => void save()} isLoading={isSaving} loadingText="Saving" isDisabled={!draft?.title.trim() || !draft?.markdown.trim()}>Replace meeting notes</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
}
