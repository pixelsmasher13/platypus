import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { marked } from 'marked';
const source = readFileSync(new URL('../noteExport.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
const { exportNote, noteExportOptions } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content });
const doc = (...content) => ({ type: 'doc', content });
const transcript = { type: 'transcript', attrs: { recordingId: '/private/audio.wav' }, content: [{ type: 'speakerTurn', attrs: { label: 'Maya', source: 'system', startMs: 1000 }, content: [p(text('Pilot Friday if QA passes.'))] }] };

test('recap exports omit transcripts by default, including nested sections', () => {
  const document = doc(p(text('Decision: pilot Friday.')), { type: 'blockquote', content: [transcript] });
  const original = JSON.stringify(document);
  assert.deepEqual(noteExportOptions(document), { hasTranscript: true, hasNotes: true });
  const output = exportNote('Team sync', document);
  for (const value of [output.markdown, output.html, output.plainText]) {
    assert.ok(value.includes('Decision: pilot Friday.'));
    assert.ok(!value.includes('QA passes'));
    assert.ok(!value.includes('Maya'));
  }
  assert.equal(JSON.stringify(document), original);
});
test('including transcripts keeps editable speaker labels but no playback controls or recording paths', () => {
  const output = exportNote('Team sync', doc(transcript), true);
  assert.deepEqual(noteExportOptions(doc(transcript, p())), { hasTranscript: true, hasNotes: false });
  assert.equal(output.empty, false);
  assert.match(output.markdown, /## Transcript\n\n\*\*Maya\*\*:/);
  assert.match(output.html, /<strong>Maya:<\/strong>/);
  for (const value of [output.markdown, output.html, output.plainText]) assert.ok(!value.includes('/private/'));
  assert.equal(exportNote('Team sync', doc(transcript)).empty, true);
});
test('headings, emphasis, ordered starts, nested lists and hard breaks survive Markdown conversion', () => {
  const document = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Next steps')] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(text('Maya', [{ type: 'bold' }]), text(' — QA')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('Friday', [{ type: 'italic' }]), { type: 'hardBreak' }, text('if ready'))] }] }] }] });
  const output = exportNote('Team sync', document);
  const parsed = marked.parse(output.markdown);
  for (const html of [parsed, output.html]) {
    assert.match(html, /<h2[^>]*>Next steps<\/h2>/);
    assert.match(html, /<ol[^>]*start="3"/);
    assert.match(html, /<strong>Maya<\/strong>/);
    assert.match(html, /<em>Friday<\/em>/);
    assert.match(html, /<ul[\s>]/);
    assert.match(html, /<br\s*\/?\s*>/);
  }
  assert.ok(!output.plainText.includes('**'));
});
test('literal Markdown, HTML characters and code delimiters are preserved without creating formatting', () => {
  const literal = '1. <draft> & **not bold** &copy;';
  const output = exportNote('<Team> *sync*', doc(p(text(literal)), p(text('a```b', [{ type: 'code' }])), { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const s = "```";')] }));
  const parsed = marked.parse(output.markdown);
  assert.ok(!parsed.includes('<ol>'));
  assert.ok(!parsed.includes('<strong>not bold'));
  assert.match(parsed, /<code>a```b<\/code>/);
  assert.match(parsed, /&lt;draft&gt;/);
  assert.match(parsed, /&amp;copy;/);
  assert.ok(!output.html.includes('<draft>'));
  assert.ok(output.plainText.includes(literal));
});
test('empty notes and portable filenames handle titles without changing displayed content', () => {
  assert.equal(exportNote('Only a title', doc(p())).empty, true);
  assert.equal(exportNote('CON', doc(p(text('Note')))).filename, '_CON.md');
  assert.equal(exportNote('  Meeting: Q4 / planning?  ', doc(p(text('Note')))).filename, 'Meeting Q4  planning.md');
  assert.equal(exportNote('', doc(p(text('Note')))).filename, 'Untitled note.md');
});
