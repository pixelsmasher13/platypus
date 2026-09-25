import { useEffect, useRef, useState } from 'react';
import { Alert, AlertIcon, Box, Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Spinner, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { marked } from 'marked';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type PolishSource = { documentId: number; html: string; provider: string; modelId: string };
const modes = [
  { id: 'tidy', label: 'Tidy up', description: 'Smooth out rough wording and verbal clutter. Keep your voice and detail.' },
  { id: 'concise', label: 'Make concise', description: 'Trim wordiness and repeated points. Keep every distinct fact and follow-up.' },
  { id: 'organize', label: 'Organize', description: 'Group related points and bring out decisions and next steps already in your note.' },
] as const;
type Mode = typeof modes[number]['id'];
const prose = { 'h1, h2, h3': { fontWeight: 600, mt: 5, mb: 2 }, h1: { fontSize: 'xl' }, h2: { fontSize: 'lg' }, 'ul, ol': { pl: 6, mb: 3 }, p: { mb: 3 }, blockquote: { borderLeft: '3px solid', borderColor: 'gray.200', pl: 4 }, pre: { whiteSpace: 'pre-wrap', bg: 'gray.50', p: 3, borderRadius: 'md' } };

export function PolishNoteModal({ source, onClose, onApply }: {
  source: PolishSource;
  onClose: () => void;
  onApply: (html: string, source: PolishSource) => void;
}) {
  const [mode, setMode] = useState<Mode>('tidy');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const retryMode = useRef<Mode>('tidy');
  const [tab, setTab] = useState(0);
  const request = useRef(0);
  const generating = useRef(false);
  const generate = async (nextMode: Mode) => {
    if (generating.current) return;
    generating.current = true;
    retryMode.current = nextMode;
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      // Every variation starts from the original, avoiding cumulative detail loss.
      const result = await invoke<string>('clean_up_document_with_llm', {
        plainText: source.html, provider: source.provider, modelId: source.modelId, mode: nextMode,
      });
      if (request.current !== id) return;
      if (!result.trim()) throw new Error('The model returned an empty draft. Try again.');
      setMarkdown(result.trim());
      setMode(nextMode);
      setTab(0);
    } catch (failure) {
      if (request.current === id) setError(String(failure));
    } finally {
      if (request.current === id) { setBusy(false); generating.current = false; }
    }
  };
  useEffect(() => {
    void generate('tidy');
    return () => { request.current += 1; generating.current = false; };
  }, []);
  const apply = async () => {
    const id = request.current;
    try {
      const html = await marked(markdown);
      if (request.current === id) onApply(html, source);
    } catch (failure) { if (request.current === id) setApplyError(String(failure)); }
  };

  return <Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside" closeOnOverlayClick={false}>
    <ModalOverlay />
    <ModalContent>
      <ModalHeader pb={2}>Clean up note</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <Text fontSize="sm" color="gray.600" mb={4}>Review the draft, then apply it to your note. You can undo the change.</Text>
        <Flex gap={2} wrap="wrap" role="group" aria-label="Cleanup style">
          {modes.map(option => <Button key={option.id} size="sm" variant={mode === option.id ? 'solid' : 'outline'} colorScheme={mode === option.id ? 'teal' : 'gray'} aria-pressed={mode === option.id} isDisabled={busy} onClick={() => void generate(option.id)}>{option.label}</Button>)}
        </Flex>
        <Text fontSize="xs" color="gray.500" mt={2} mb={4}>{modes.find(option => option.id === mode)?.description}</Text>
        {error && <Alert status="error" mb={4} borderRadius="md"><AlertIcon /><Text fontSize="sm" flex={1}>{error}</Text><Button size="sm" ml={2} onClick={() => void generate(retryMode.current)} isDisabled={busy}>Retry</Button></Alert>}
        {applyError && <Alert status="warning" mb={4} borderRadius="md"><AlertIcon /><Text fontSize="sm">{applyError}</Text></Alert>}
        {busy && <Flex gap={3} align="center" py={4} role="status"><Spinner size="sm" /><Text fontSize="sm">Cleaning up your note…</Text></Flex>}
        <Tabs colorScheme="teal" index={tab} onChange={setTab} isLazy>
          <TabList><Tab>Cleaned up</Tab><Tab>Original</Tab><Tab isDisabled={!markdown || busy}>Edit draft</Tab></TabList>
          <TabPanels>
            <TabPanel px={0}><Box minH="220px" fontSize="sm" lineHeight="1.8" sx={prose} opacity={busy ? 0.5 : 1}><ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown></Box></TabPanel>
            <TabPanel px={0}><Box minH="220px" fontSize="sm" lineHeight="1.8" sx={prose} dangerouslySetInnerHTML={{ __html: source.html }} /></TabPanel>
            <TabPanel px={0}><Textarea aria-label="Cleaned-up note draft" value={markdown} minH="320px" fontSize="sm" onChange={event => setMarkdown(event.target.value)} /></TabPanel>
          </TabPanels>
        </Tabs>
      </ModalBody>
      <ModalFooter gap={2}>
        <Button variant="ghost" onClick={onClose}>{busy ? 'Cancel' : 'Keep original'}</Button>
        <Button colorScheme="teal" isDisabled={busy || !!applyError || !markdown.trim()} onClick={() => void apply()}>Apply to note</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
}
