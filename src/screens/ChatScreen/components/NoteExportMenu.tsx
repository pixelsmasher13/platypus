import { useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuItemOption, MenuList, MenuOptionGroup, Spinner, Tooltip } from '@chakra-ui/react';
import { Copy, Download, FileDown } from 'lucide-react';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { writeText } from '@tauri-apps/api/clipboard';
import { exportNote, noteExportOptions } from '../noteExport';
import { useNotify } from './notifications';

async function copyFormatted(note: ReturnType<typeof exportNote>): Promise<boolean> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([note.html], { type: 'text/html' }),
        'text/plain': new Blob([note.plainText], { type: 'text/plain' }),
      })]);
      return true;
    } catch { /* Try the WebView's copy event before falling back to plain text. */ }
  }
  let copied = false;
  const handler = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/html', note.html);
    event.clipboardData.setData('text/plain', note.plainText);
    copied = true;
  };
  document.addEventListener('copy', handler);
  let succeeded = false;
  try { succeeded = document.execCommand('copy'); } catch { /* Plain-text fallback below. */ }
  finally { document.removeEventListener('copy', handler); }
  if (copied && succeeded) return true;
  try { await navigator.clipboard.writeText(note.plainText); }
  catch { await writeText(note.plainText); }
  return false;
}

export function NoteExportMenu({ getSnapshot, disabled = false }: {
  getSnapshot: () => { title: string; document: JSONContent };
  disabled?: boolean;
}) {
  const notify = useNotify();
  const busy = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const open = () => {
    const options = noteExportOptions(getSnapshot().document);
    setHasTranscript(options.hasTranscript);
    // Transcript-only recordings export their content; recaps omit it by default.
    setIncludeTranscript(options.hasTranscript && !options.hasNotes);
  };
  const run = async (kind: 'copy' | 'markdown') => {
    if (busy.current) return;
    const { title, document } = getSnapshot();
    const note = exportNote(title, document, includeTranscript);
    if (note.empty) {
      notify({ title: 'Nothing to export', description: hasTranscript ? 'Include the transcript or add some notes first.' : 'Write something in this note first.' });
      return;
    }
    busy.current = true; setIsExporting(true);
    try {
      if (kind === 'copy') {
        const formatted = await copyFormatted(note);
        notify({ title: formatted ? 'Note copied' : 'Copied as plain text', description: formatted ? 'Ready to paste into an email or document.' : 'Rich formatting isn’t available in this clipboard.', status: 'success' });
      } else {
        const path = await save({ defaultPath: note.filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (!path) return;
        await writeTextFile(path, note.markdown);
        notify({ title: 'Markdown exported', description: 'Your note is saved as a .md file.', status: 'success' });
      }
    } catch (error) {
      notify({ title: kind === 'copy' ? 'Could not copy note' : 'Could not export note', description: String(error), status: 'error' });
    } finally { busy.current = false; setIsExporting(false); }
  };
  return <Menu placement="bottom-end" onOpen={open} isLazy>
    <Tooltip label="Export note"><MenuButton as={IconButton} aria-label="Export note" icon={isExporting ? <Spinner size="xs" /> : <FileDown size={16} />} size="sm" variant="ghost" isDisabled={disabled || isExporting} /></Tooltip>
    <MenuList minW="230px">
      <MenuItem icon={<Copy size={15} />} onClick={() => void run('copy')}>Copy formatted</MenuItem>
      <MenuItem icon={<Download size={15} />} onClick={() => void run('markdown')}>Download Markdown (.md)</MenuItem>
      {hasTranscript && <><MenuDivider /><MenuOptionGroup type="checkbox" value={includeTranscript ? ['transcript'] : []} onChange={value => setIncludeTranscript(value.includes('transcript'))}>
        <MenuItemOption value="transcript" closeOnSelect={false}>Include transcript</MenuItemOption>
      </MenuOptionGroup></>}
    </MenuList>
  </Menu>;
}
