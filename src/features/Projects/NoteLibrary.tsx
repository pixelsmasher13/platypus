import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Box, Button, Flex, IconButton, Input, InputGroup, InputLeftElement, InputRightElement,
  Menu, MenuButton, MenuItem, MenuList, MenuOptionGroup, MenuItemOption, Spinner, Text, Tooltip, useToast,
} from '@chakra-ui/react';
import { ArrowDownUp, Edit, File, MoreHorizontal, Search, Trash2, X } from 'lucide-react';
import type { Project } from '../../data/project';
import {
  collectNotes, LIBRARY_PREFERENCES_KEY, parseLibraryPreferences, selectLibraryNotes,
  type NoteSort,
} from './noteLibraryModel';

const EMPTY_MATCHES = new Set<number>();

type Props = {
  projects: Project[];
  selectedProject?: Project;
  selectedNoteId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number, name: string) => void | Promise<void>;
  onDelete: (id: number) => void;
  onCreate: () => void;
  onPaste: (event: React.ClipboardEvent) => void;
};

export function NoteLibrary({ projects, selectedProject, selectedNoteId, onSelect, onRename, onDelete, onCreate, onPaste }: Props) {
  const [query, setQuery] = useState('');
  const term = query.trim();
  const [preferences, setPreferences] = useState(() => {
    try { return parseLibraryPreferences(localStorage.getItem(LIBRARY_PREFERENCES_KEY)); }
    catch { return parseLibraryPreferences(null); }
  });
  const [search, setSearch] = useState<{ term: string; ids: Set<number>; error: boolean } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const renameInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    try { localStorage.setItem(LIBRARY_PREFERENCES_KEY, JSON.stringify(preferences)); }
    catch { /* Keep library controls usable even if storage is unavailable. */ }
  }, [preferences]);

  // Results belong to one query. Never reuse the previous query's content hits
  // while a new request is waiting, or when an older request finishes last.
  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const ids = await invoke<number[]>('search_documents_content', { searchTerm: term });
        if (!cancelled) setSearch({ term, ids: new Set(ids), error: false });
      } catch {
        if (!cancelled) setSearch({ term, ids: EMPTY_MATCHES, error: true });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, projects]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f' &&
          !event.altKey && !document.querySelector('[role="dialog"], [role="alertdialog"]') &&
          searchRef.current?.getClientRects().length) {
        event.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const notes = useMemo(() => collectNotes(selectedProject ? [selectedProject] : projects), [projects, selectedProject]);
  const matches = search?.term === term && term.length >= 2 ? search.ids : EMPTY_MATCHES;
  const results = useMemo(() => selectLibraryNotes(notes, term, matches, preferences), [notes, term, matches, preferences]);
  const searching = term.length >= 2 && search?.term !== term;
  const searchFailed = term.length >= 2 && search?.term === term && search.error;
  const resetFilters = () => {
    setQuery('');
    searchRef.current?.focus();
  };
  const saveRename = async () => {
    if (editingId === null || renameInFlight.current) return;
    if (!name.trim()) { setEditingId(null); return; }
    renameInFlight.current = true;
    setSaving(true);
    try { await onRename(editingId, name.trim()); setEditingId(null); }
    catch { toast({ title: 'Could not rename note', description: 'Your title is still here. Try again.', status: 'error' }); }
    finally { renameInFlight.current = false; setSaving(false); }
  };
  const focusNote = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-note-button]');
    if (!buttons?.length) return;
    const nextIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[nextIndex].focus();
    onSelect(results[nextIndex].id);
  };

  return (
    <Flex direction="column" flex={1} minH={0} gap={3}>
      <InputGroup>
        <InputLeftElement pointerEvents="none"><Search size={16} /></InputLeftElement>
        <Input ref={searchRef} data-note-navigation aria-label="Search notes" placeholder="Search notes & content…" value={query}
          onChange={event => setQuery(event.target.value)} borderRadius="lg" pr={9}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setQuery(''); }
            if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); focusNote(0); }
            if (event.key === 'Enter' && results.length === 1) { event.preventDefault(); focusNote(0); }
          }} />
        {query && <InputRightElement><IconButton aria-label="Clear search" icon={<X size={14} />} size="xs" variant="ghost"
          onClick={() => { setQuery(''); searchRef.current?.focus(); }} /></InputRightElement>}
      </InputGroup>
      <Flex align="center" justify="space-between" gap={2}>
        <Flex align="center" gap={2} color="gray.500" fontSize="xs" role="status" aria-live="polite">
          {searching && <Spinner size="xs" />}
          <Text>{searching ? 'Searching content…' : `${results.length} ${results.length === 1 ? 'note' : 'notes'}${term ? ' found' : ''}`}</Text>
        </Flex>
        <Menu placement="bottom-end">
          <Tooltip label="Sort notes">
            <MenuButton as={IconButton} aria-label="Sort notes" icon={<ArrowDownUp size={16} />} size="xs" variant="ghost" />
          </Tooltip>
          <MenuList minW="160px">
            <MenuOptionGroup type="radio" value={preferences.sort}
              onChange={value => setPreferences({ sort: value as NoteSort })}>
              <MenuItemOption value="newest">Newest first</MenuItemOption>
              <MenuItemOption value="oldest">Oldest first</MenuItemOption>
              <MenuItemOption value="title">Title A–Z</MenuItemOption>
            </MenuOptionGroup>
          </MenuList>
        </Menu>
      </Flex>
      {searchFailed && <Text fontSize="xs" color="orange.700">Content search is unavailable. Showing title and project matches.</Text>}
      <Box ref={listRef} flex={1} minH={0} overflowY="auto" onPaste={onPaste} aria-label="Notes" role="region">
        {results.map((note, index) => (
          <Flex key={note.id} role="group" align="start" gap={1} mb={1} borderRadius="lg" border="1px solid transparent"
            position="relative" bg="transparent" _hover={{ bg: 'gray.50' }}
            _before={selectedNoteId === note.id ? {
              content: '""', position: 'absolute', left: 0, top: '12px',
              width: '2px', height: '22px', borderRadius: 'full', bg: '#91B5AE', pointerEvents: 'none',
            } : undefined}>
            {editingId === note.id ? (
              <Input aria-label="Note title" m={2} size="sm" autoFocus value={name} isReadOnly={saving}
                onPaste={event => event.stopPropagation()}
                onChange={event => setName(event.target.value)} onBlur={() => void saveRename()}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                  if (event.key === 'Escape' && !saving) { event.preventDefault(); setEditingId(null); }
                }} />
            ) : (
              <Button data-note-button data-note-navigation variant="unstyled" display="flex" alignItems="flex-start" justifyContent="flex-start" gap={3} flex={1} minW={0}
                height="auto" textAlign="left" whiteSpace="normal" p={3} fontWeight="normal" borderRadius="lg"
                aria-current={selectedNoteId === note.id ? 'page' : undefined}
                onClick={event => { event.currentTarget.focus(); onSelect(note.id); }}
                onKeyDown={event => {
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    focusNote(event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
                  }
                }}>
                <Box mt="3px" flexShrink={0} color="gray.400"><File size={15} /></Box>
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight={selectedNoteId === note.id ? 'medium' : 'normal'} lineHeight="1.5" noOfLines={2} title={note.name} overflowWrap="anywhere">{note.name}</Text>
                  {!selectedProject && <Text fontSize="xs" color="gray.500" mt={1} noOfLines={1}>{note.projectName}</Text>}
                  {term && matches.has(note.id) && !note.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()) &&
                    <Text fontSize="xs" color="teal.600" mt={1}>Match in content</Text>}
                </Box>
              </Button>
            )}
            <Menu placement="bottom-end" isLazy strategy="fixed">
              <Tooltip label="Note options"><MenuButton as={IconButton} aria-label={`Options for ${note.name}`}
                icon={<MoreHorizontal size={15} />} size="xs" variant="ghost" mt={3} mr={1} /></Tooltip>
              <MenuList minW="160px">
                <MenuItem icon={<Edit size={14} />} onClick={() => { setEditingId(note.id); setName(note.name); }}>Rename</MenuItem>
                <MenuItem color="red.500" icon={<Trash2 size={14} />} onClick={() => onDelete(note.id)}>Delete</MenuItem>
              </MenuList>
            </Menu>
          </Flex>
        ))}
        {!results.length && !searching && <Flex direction="column" align="center" textAlign="center" px={3} py={8} gap={3}>
          <Box color="gray.400">{term ? <Search size={24} /> : <File size={24} />}</Box>
          <Text fontSize="sm" fontWeight="medium">{term ? 'No matching notes' : 'A fresh space for your ideas'}</Text>
          <Text fontSize="xs" color="gray.500">{term ? 'Try another phrase or clear your search.' : 'Capture a thought, plan your day, or start meeting notes.'}</Text>
          {term ? <Button size="sm" variant="outline" onClick={resetFilters}>Clear search</Button>
            : <Button size="sm" colorScheme="teal" onClick={onCreate}>Create your first note</Button>}
        </Flex>}
      </Box>
    </Flex>
  );
}
