import { createContext, useCallback, useContext, useRef, useState, type PropsWithChildren } from 'react';
import { Box, Button, Flex, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Spinner, Text } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { Presentation } from 'lucide-react';
import { useNotify } from '../screens/ChatScreen/components/notifications';
import { SlideGeneratorModal } from '../screens/ChatScreen/components/SlideGeneratorModal';
import { PresentationJobs, mergePresentations, type PresentationJob, type PresentationRequest, type SavedPresentation } from '../screens/ChatScreen/slides/presentationJobs';
import type { Slide } from '../screens/ChatScreen/slides/slideDeck';

type Context = { start: (request: PresentationRequest) => boolean; openLibrary: () => void; runningCount: number };
const PresentationsContext = createContext<Context | null>(null);
export function usePresentations() {
  const context = useContext(PresentationsContext);
  if (!context) throw new Error('PresentationsProvider is missing');
  return context;
}

export function PresentationsProvider({ children }: PropsWithChildren) {
  const notify = useNotify();
  const [jobs, setJobs] = useState<PresentationJob[]>([]);
  const [decks, setDecks] = useState<SavedPresentation[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<SavedPresentation | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const saved = await invoke<SavedPresentation[]>('list_saved_presentations');
      setDecks(previous => mergePresentations(previous, saved));
    } catch (failure) { setError(String(failure)); }
    finally { setLoading(false); }
  }, []);
  const openLibrary = useCallback(() => { setLibraryOpen(true); void refresh(); }, [refresh]);
  const controller = useRef<PresentationJobs>();
  if (!controller.current) controller.current = new PresentationJobs(
    request => invoke<SavedPresentation>('generate_saved_presentation', { request }),
    {
      changed: setJobs,
      started: job => notify({ id: job.id, title: 'Creating your slide deck', description: `“${job.request.sourceTitle}” is generating in the background. We'll let you know when it's done.`, status: 'loading', duration: null, action: { label: 'View presentations', onClick: openLibrary } }),
      completed: (job, deck) => {
        setDecks(previous => mergePresentations(previous, [deck]));
        notify({ id: job.id, title: 'Your slide deck is ready', description: `${deck.slide_count} slides from “${deck.source_title}”, saved automatically.`, status: 'success', duration: null, action: { label: 'Open deck', onClick: () => { setLibraryOpen(false); setActive(deck); } } });
      },
      failed: job => notify({ id: job.id, title: 'Could not create your deck', description: job.error, status: 'error', duration: null, action: { label: 'Retry', onClick: () => controller.current?.retry(job.id) } }),
    }
  );
  const start = (request: PresentationRequest) => {
    const accepted = controller.current!.start(request);
    if (!accepted) notify({ title: 'This note already has a deck generating', description: 'You can keep working while it finishes.', action: { label: 'View presentations', onClick: openLibrary } });
    return accepted;
  };
  const saveSlides = async (deck: SavedPresentation, slides: Slide[]) => {
    const saved = await invoke<SavedPresentation>('update_saved_presentation', { id: deck.id, slides });
    setDecks(previous => mergePresentations(previous, [saved]));
    // Keep the editor's initial snapshot stable while it is open.
  };
  return <PresentationsContext.Provider value={{ start, openLibrary, runningCount: jobs.filter(job => job.status === 'running').length }}>
    {children}
    <Modal isOpen={libraryOpen} onClose={() => setLibraryOpen(false)} size="2xl" scrollBehavior="inside">
      <ModalOverlay /><ModalContent maxH="85vh"><ModalHeader><Flex align="center" gap={2}><Presentation size={20} />Presentations</Flex></ModalHeader><ModalCloseButton />
        <ModalBody pb={5}>
          <Text fontSize="sm" color="gray.600" mb={4}>Decks are saved on this device and stay here after you close the app. Keep Platypus open while generation is running.</Text>
          <Flex direction="column" gap={3}>
            {jobs.map(job => <Box key={job.id} p={4} borderWidth="1px" borderRadius="lg" borderColor={job.status === 'failed' ? 'orange.200' : 'gray.200'}>
              <Flex align="center" gap={2}>{job.status === 'running' && <Spinner size="sm" />}<Text fontWeight="medium">{job.request.sourceTitle}</Text></Flex>
              <Text fontSize="sm" mt={2} color="gray.600">{job.status === 'running' ? 'Generating in the background… We’ll let you know when it’s done.' : job.error}</Text>
              {job.status === 'failed' && <Flex gap={2} mt={3}><Button size="sm" onClick={() => controller.current?.retry(job.id)}>Retry</Button><Button size="sm" variant="ghost" onClick={() => controller.current?.dismiss(job.id)}>Dismiss</Button></Flex>}
            </Box>)}
            {loading && <Flex gap={2} align="center" role="status"><Spinner size="sm" /><Text fontSize="sm">Loading saved decks…</Text></Flex>}
            {error && <Box role="alert"><Text color="red.600" fontSize="sm">{error}</Text><Button size="sm" mt={2} onClick={() => void refresh()}>Try again</Button></Box>}
            {!loading && !error && !decks.length && !jobs.length && <Text py={8} textAlign="center" color="gray.500">Your presentations will appear here. Start from a note’s Generate menu.</Text>}
            {decks.map(deck => <Flex key={deck.id} gap={3} p={4} align="center" borderWidth="1px" borderColor="gray.200" borderRadius="lg">
              <Presentation size={22} color="#0f766e" /><Box flex={1} minW={0}><Text fontWeight="medium" noOfLines={2}>{deck.title}</Text><Text fontSize="xs" color="gray.500" mt={1}>{deck.slide_count} slides · {deck.kind === 'designed' ? 'PowerPoint' : 'Editable draft'} · {new Date(deck.created_at).toLocaleString()}</Text><Text fontSize="xs" color="gray.500" noOfLines={1}>From {deck.source_title}</Text></Box>
              <Button size="sm" variant="outline" onClick={() => { setLibraryOpen(false); setActive(deck); }}>Open</Button>
            </Flex>)}
          </Flex>
        </ModalBody><ModalFooter><Button variant="ghost" onClick={() => setLibraryOpen(false)}>Close</Button></ModalFooter>
      </ModalContent>
    </Modal>
    {active && <SlideGeneratorModal key={active.id} isOpen onClose={() => setActive(null)} plainText="" provider={active.kind === 'designed' ? 'openai' : ''} modelId={active.model} initialDeck={active} onSaveDeck={slides => saveSlides(active, slides)} />}
  </PresentationsContext.Provider>;
}
