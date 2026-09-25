import { useGlobalSettings } from "../../../Providers/SettingsProvider";
import { EffortSelector } from "./EffortSelector";
import { DEFAULT_MODELS, MODEL_OPTIONS, selectedEffort, type ModelProvider } from '../../../models/models';
import { type FC, useEffect, useRef, useState } from 'react';
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  Button, Flex, Box, Text, Textarea, HStack, IconButton, useToast, Input, Select,
  Tabs, TabList, TabPanels, Tab, TabPanel, Menu, MenuButton, MenuList, MenuItem,
} from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile, writeTextFile } from '@tauri-apps/api/fs';
import { Presentation, ChevronLeft, ChevronRight, Download, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { SlidePreview } from '../slides/SlidePreview';
import { createPowerPoint } from '../slides/exportPowerPoint';
import { slideIssues, slidesToMarkdown, type Slide, type SlideLayout } from '../slides/slideDeck';
import type { PresentationRequest, SavedPresentation } from '../slides/presentationJobs';
export type { Slide } from '../slides/slideDeck';

type Props = {
  isOpen: boolean; onClose: () => void; plainText: string; provider: string; modelId?: string;
  sourceId?: number; sourceTitle?: string; initialDeck?: SavedPresentation;
  onGenerate?: (request: PresentationRequest) => boolean;
  onSaveDeck?: (slides: Slide[]) => Promise<void>;
};

export const SlideGeneratorModal: FC<Props> = ({ isOpen, onClose, plainText, provider, modelId, sourceId, sourceTitle, initialDeck, onGenerate, onSaveDeck }) => {
  const toast = useToast();
  const { isSavingEffort, modelEfforts } = useGlobalSettings();
  const [audience, setAudience] = useState('');
  const [purpose, setPurpose] = useState('Brief the team');
  const [focus, setFocus] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [selectedModel, setSelectedModel] = useState(modelId || DEFAULT_MODELS[provider as ModelProvider]);
  const [generationStyle, setGenerationStyle] = useState<'designed' | 'simple'>(provider === 'openai' ? 'designed' : 'simple');
  const designedDeck = initialDeck?.kind === 'designed' ? initialDeck : null;
  const [isExporting, setIsExporting] = useState(false);
  const [slides, setSlides] = useState<Slide[]>(initialDeck?.slides || []);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showBrief, setShowBrief] = useState(!initialDeck);
  const savedSnapshot = useRef(JSON.stringify(initialDeck?.slides || []));
  const exportRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setSlides([]);
      setCurrentSlide(0);
      setShowBrief(true);
      setAudience(''); setPurpose('Brief the team'); setFocus(''); setSlideCount(5);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(provider);
      setSelectedModel(modelId || DEFAULT_MODELS[provider as ModelProvider]);
      setGenerationStyle(provider === 'openai' ? 'designed' : 'simple');
    }
  }, [isOpen, provider, modelId]);

  const persistChanges = async () => {
    const snapshot = JSON.stringify(slides);
    if (onSaveDeck && snapshot !== savedSnapshot.current) {
      await onSaveDeck(slides);
      savedSnapshot.current = snapshot;
    }
  };
  const handleClose = async () => {
    if (exportRef.current) return;
    exportRef.current = true; setIsExporting(true);
    try { await persistChanges(); onClose(); }
    catch (error) { toast({ title: 'Could not save your changes', description: String(error), status: 'error', duration: 6000, isClosable: true }); }
    finally { exportRef.current = false; setIsExporting(false); }
  };
  const handleGenerate = () => {
    if (!plainText.trim() || isSavingEffort || !onGenerate) return;
    const accepted = onGenerate({
      plainText, provider: selectedProvider, modelId: selectedModel, slideCount, kind: generationStyle,
      sourceId, sourceTitle: sourceTitle?.trim() || 'Untitled note', effort: selectedEffort(selectedModel, modelEfforts),
      focus: [`Audience: ${audience.trim() || 'Readers familiar with the topic'}`, `Purpose: ${purpose}`, focus.trim()].filter(Boolean).join('\n'),
    });
    if (accepted) onClose();
  };
  const openPowerPoint = async () => {
    if (!designedDeck) return;
    try { await invoke('open_saved_presentation', { id: designedDeck.id }); }
    catch (error) { toast({ title: 'Could not open PowerPoint', description: String(error), status: 'error', duration: 6000, isClosable: true }); }
  };
  const updateSlide = (changes: Partial<Slide>) => setSlides(previous => previous.map((slide, i) => i === currentSlide ? { ...slide, ...changes } : slide));
  const moveSlide = (direction: number) => {
    const next = currentSlide + direction;
    if (next < 0 || next >= slides.length) return;
    setSlides(previous => { const reordered = [...previous]; [reordered[currentSlide], reordered[next]] = [reordered[next], reordered[currentSlide]]; return reordered; });
    setCurrentSlide(next);
  };
  const issues = slides.map(slideIssues);
  const hasIssues = issues.some(items => items.length);
  const handleExport = async (format: 'pptx' | 'md') => {
    if ((!slides.length && !designedDeck) || exportRef.current) return;
    exportRef.current = true;
    setIsExporting(true);
    try {
      await persistChanges();
      const title = designedDeck ? designedDeck.title : slides[0].title;
      const filename = (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Presentation').slice(0, 80);
      const path = await save({ defaultPath: `${filename}.${format}`, filters: [{ name: format === 'pptx' ? 'PowerPoint' : 'Markdown', extensions: [format] }] });
      if (!path) return;
      if (format === 'pptx') await writeBinaryFile(path, designedDeck ? new Uint8Array(await invoke<number[]>('read_saved_presentation_file', { id: designedDeck.id })) : await createPowerPoint(slides));
      else await writeTextFile(path, slidesToMarkdown(slides));
      toast({ title: 'Deck exported', description: format === 'pptx' ? 'Editable slides and speaker notes saved to PowerPoint.' : 'Saved in Marp format, with speaker notes.', status: 'success', duration: 4000, isClosable: true });
    } catch (error) {
      toast({ title: 'Export failed', description: String(error), status: 'error', duration: 6000, isClosable: true });
    } finally { exportRef.current = false; setIsExporting(false); }
  };
  const slide = slides[currentSlide];

  return <Modal isOpen={isOpen} onClose={handleClose} size={showBrief || designedDeck ? 'xl' : '6xl'} scrollBehavior="inside" closeOnOverlayClick={false}>
    <ModalOverlay />
    <ModalContent maxH="92vh">
      <ModalHeader><Flex align="center" gap={2}><Presentation size={20} />{showBrief ? 'Build a presentation' : 'Your slide deck'}</Flex></ModalHeader>
      <ModalCloseButton isDisabled={isExporting} />
      <ModalBody>
        {showBrief ? <Flex direction="column" gap={4}>
          <Text fontSize="sm" color="gray.600">Build a presentation around the strongest ideas and evidence in this note.</Text>
          <Box><Text as="label" htmlFor="slide-model" fontSize="sm" fontWeight="medium">Model</Text>
            <Select id="slide-model" mt={1} value={selectedModel} onChange={event => {
              const model = MODEL_OPTIONS.find(item => item.id === event.target.value);
              if (!model) return;
              setSelectedModel(model.id); setSelectedProvider(model.provider);
              setGenerationStyle(model.provider === 'openai' ? 'designed' : 'simple');
            }}>
              {!MODEL_OPTIONS.some(item => item.id === selectedModel) && <option value={selectedModel}>{selectedModel}</option>}
              {MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </Select></Box>
          {selectedModel && <EffortSelector model={selectedModel} />}
          <Box><Text as="label" htmlFor="slide-style" fontSize="sm" fontWeight="medium">Presentation style</Text>
            <Select id="slide-style" mt={1} value={generationStyle} onChange={event => setGenerationStyle(event.target.value as 'designed' | 'simple')}>
              {selectedProvider === 'openai' && <option value="designed">Designed PowerPoint</option>}
              <option value="simple">Simple slides</option>
            </Select>
            <Text fontSize="xs" color="gray.500" mt={2}>{generationStyle === 'designed'
              ? 'The model builds a PowerPoint with layouts and supporting detail suited to your source. It runs in the background and saves automatically.'
              : 'A faster deck of key points. Preview and edit slides here before exporting. Choose an OpenAI model for a designed PowerPoint.'}</Text></Box>
          <Box><Text as="label" htmlFor="slide-audience" fontSize="sm" fontWeight="medium">Who is it for?</Text>
            <Input id="slide-audience" mt={1} value={audience} onChange={event => setAudience(event.target.value)} placeholder="e.g. leadership team, customers, new teammates" /></Box>
          <Box><Text as="label" htmlFor="slide-purpose" fontSize="sm" fontWeight="medium">What should the deck accomplish?</Text>
            <Select id="slide-purpose" mt={1} value={purpose} onChange={event => setPurpose(event.target.value)}>
              <option>Brief the team</option><option>Explain a topic</option><option>Support a decision</option><option>Present research findings</option><option>Propose a plan</option>
            </Select></Box>
          <Box><Text as="label" htmlFor="slide-focus" fontSize="sm" fontWeight="medium">Anything to emphasize?</Text>
            <Textarea id="slide-focus" mt={1} value={focus} onChange={event => setFocus(event.target.value)} placeholder="Key message, questions to answer, or details to leave out" rows={3} /></Box>
          <Box><Text fontSize="sm" fontWeight="medium" mb={2}>Target length</Text><HStack flexWrap="wrap">{[2, 5, 8, 10, 15].map(count => <Button key={count} size="sm" aria-pressed={count === slideCount} colorScheme={count === slideCount ? 'teal' : 'gray'} variant={count === slideCount ? 'solid' : 'outline'} onClick={() => setSlideCount(count)}>{count} slides</Button>)}</HStack>
            <Text fontSize="xs" color="gray.500" mt={2}>Short sources may produce fewer slides to avoid repetition.</Text></Box>
          {!plainText.trim() && <Text color="orange.700" fontSize="sm">Write or import a note before generating a deck.</Text>}
        </Flex> : designedDeck ? <Flex direction="column" gap={4} py={4}>
          <Presentation size={36} color="#0f766e" />
          <Text fontSize="lg" fontWeight="semibold">Your PowerPoint is ready</Text>
          <Text>{designedDeck.slide_count} slides · {MODEL_OPTIONS.find(model => model.id === designedDeck.model)?.name || designedDeck.model}{designedDeck.effort ? ` · ${designedDeck.effort} effort` : ''}</Text>
          <Text fontSize="sm" color="gray.600">Saved automatically on this device. Open it in PowerPoint or Keynote to review and edit, or save a copy wherever you like.</Text>
          <Text fontSize="xs" color="gray.500">Created in {Math.floor(designedDeck.elapsed_seconds / 60)}m {designedDeck.elapsed_seconds % 60}s. Find it anytime in Presentations.</Text>
          <Text fontSize="xs" color="gray.500" overflowWrap="anywhere">{designedDeck.file_path}</Text>
        </Flex> : slide && <Flex direction={{ base: 'column', md: 'row' }} gap={5}>
          <Box width={{ base: '100%', md: '185px' }} flexShrink={0} maxH={{ base: '120px', md: '65vh' }} overflowY="auto" aria-label="Slide outline" role="navigation">
            {slides.map((item, index) => <Button key={index} variant="ghost" width="full" height="auto" minH="48px" py={2} px={3} mb={1} whiteSpace="normal" textAlign="left" justifyContent="flex-start" fontSize="xs" fontWeight="normal" gap={2}
              bg={index === currentSlide ? 'teal.50' : undefined} aria-current={index === currentSlide ? 'step' : undefined} onClick={() => setCurrentSlide(index)}>
              <Text color={issues[index].length ? 'orange.600' : 'gray.500'}>{index + 1}{issues[index].length ? ' !' : ''}</Text><Text noOfLines={2}>{item.title || 'Untitled slide'}</Text>
            </Button>)}
            <Button size="xs" leftIcon={<Plus size={12} />} variant="ghost" mt={2} isDisabled={slides.length >= 30 || isExporting} onClick={() => { setSlides(previous => [...previous, { title: 'New slide', bullets: [''], layout: 'content', speaker_notes: '' }]); setCurrentSlide(slides.length); }}>Add slide</Button>
          </Box>
          <Flex direction="column" gap={3} flex={1} minW={0}>
            <Flex align="center" justify="space-between"><Text fontSize="sm" color="gray.600">Slide {currentSlide + 1} of {slides.length}</Text><HStack spacing={1}>
              <IconButton aria-label="Move slide earlier" icon={<ArrowUp size={14} />} size="xs" variant="ghost" isDisabled={currentSlide === 0 || isExporting} onClick={() => moveSlide(-1)} />
              <IconButton aria-label="Move slide later" icon={<ArrowDown size={14} />} size="xs" variant="ghost" isDisabled={currentSlide === slides.length - 1 || isExporting} onClick={() => moveSlide(1)} />
              <IconButton aria-label="Delete slide" icon={<Trash2 size={14} />} size="xs" variant="ghost" isDisabled={slides.length === 1 || isExporting} onClick={() => { setSlides(previous => previous.filter((_, i) => i !== currentSlide)); setCurrentSlide(Math.max(0, currentSlide - 1)); }} />
              <IconButton aria-label="Previous slide" icon={<ChevronLeft size={16} />} size="sm" variant="ghost" isDisabled={currentSlide === 0} onClick={() => setCurrentSlide(i => i - 1)} />
              <IconButton aria-label="Next slide" icon={<ChevronRight size={16} />} size="sm" variant="ghost" isDisabled={currentSlide === slides.length - 1} onClick={() => setCurrentSlide(i => i + 1)} />
            </HStack></Flex>
            <SlidePreview slide={slide} index={currentSlide} total={slides.length} />
            {issues[currentSlide].length > 0 && <Box role="status" fontSize="xs" color="orange.800" bg="orange.50" borderRadius="md" p={3}>{issues[currentSlide].map(issue => <Text key={issue}>{issue}</Text>)}</Box>}
            <Tabs colorScheme="teal" size="sm"><TabList><Tab>Edit slide</Tab><Tab>Speaker notes</Tab></TabList><TabPanels>
              <TabPanel px={0}><Flex direction="column" gap={3}>
                <Flex gap={2}><Input aria-label="Slide title" value={slide.title} onChange={event => updateSlide({ title: event.target.value })} isDisabled={isExporting} />
                  <Select aria-label="Slide layout" value={slide.layout || 'content'} maxW="150px" onChange={event => updateSlide({ layout: event.target.value as SlideLayout })} isDisabled={isExporting}>
                    <option value="title">Title</option><option value="content">Key points</option><option value="steps">Steps</option><option value="takeaway">Takeaway</option>
                  </Select></Flex>
                <Textarea aria-label="Slide points, one per line" value={slide.bullets.join('\n')} onChange={event => updateSlide({ bullets: event.target.value.split('\n') })} rows={4} fontSize="sm" isDisabled={isExporting} />
                <Text fontSize="xs" color="gray.500">One point per line. Keep supporting detail in speaker notes.</Text>
              </Flex></TabPanel>
              <TabPanel px={0}><Textarea aria-label="Speaker notes" value={slide.speaker_notes || ''} onChange={event => updateSlide({ speaker_notes: event.target.value })} rows={5} fontSize="sm" placeholder="What you will say while this slide is on screen" isDisabled={isExporting} /></TabPanel>
            </TabPanels></Tabs>
          </Flex>
        </Flex>}
      </ModalBody>
      <ModalFooter gap={2} flexWrap="wrap">
        {showBrief ? <>
          <Button variant="ghost" onClick={handleClose}>Close</Button>
          {(!!slides.length || !!designedDeck) && <Button variant="outline" onClick={() => setShowBrief(false)}>Back to deck</Button>}
          <Button colorScheme="teal" leftIcon={<Presentation size={15} />} onClick={() => void handleGenerate()} isDisabled={!plainText.trim() || isSavingEffort}>Generate deck</Button>
        </> : <>
          {hasIssues && <Text fontSize="xs" color="orange.700" mr="auto">Fix slides marked ! before PowerPoint export.</Text>}
          <Button variant="ghost" onClick={() => void handleClose()} isDisabled={isExporting}>Close</Button>
          {!designedDeck && <Text fontSize="xs" color="gray.500" mr="auto">Saved to Presentations. Changes save on close or export.</Text>}
          {designedDeck && <Button variant="outline" onClick={() => void openPowerPoint()}>Open PowerPoint</Button>}
          {!designedDeck && <Menu><MenuButton as={Button} variant="outline" isDisabled={isExporting}>More</MenuButton><MenuList><MenuItem onClick={() => void handleExport('md')}>Export Markdown</MenuItem></MenuList></Menu>}
          <Button colorScheme="teal" leftIcon={<Download size={15} />} onClick={() => void handleExport('pptx')} isLoading={isExporting} loadingText="Exporting" isDisabled={hasIssues}>{designedDeck ? 'Save a copy' : 'Export PowerPoint'}</Button>
        </>}
      </ModalFooter>
    </ModalContent>
  </Modal>;
};
