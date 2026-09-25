import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const { outputText } = ts.transpileModule(readFileSync(new URL('../meetingSources.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } });
const { extractMeetingSources, transcriptNode, transcriptHtml } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content) => ({ type: 'doc', content });

test('separates personal priorities from evidence across multiple recording sessions', () => {
  const note = doc(paragraph('Onboarding: why are people leaving?'),
    transcriptNode('Maya: 38% drop off. Only 12 interviews.\nTom: Next Wednesday IF QA passes.'),
    paragraph('Watch the launch caveat.'), transcriptNode('Maya: No analytics owner assigned.'));
  assert.deepEqual(extractMeetingSources(note), {
    notes: 'Onboarding: why are people leaving?\n\nWatch the launch caveat.',
    transcript: 'Maya: 38% drop off. Only 12 interviews.\nTom: Next Wednesday IF QA passes.\n\nMaya: No analytics owner assigned.',
  });
});
test('keeps legacy notes as notes rather than guessing which sentences are transcription', () => {
  assert.deepEqual(extractMeetingSources(doc(paragraph('Voice note: launch maybe Friday'))), {
    notes: 'Voice note: launch maybe Friday', transcript: '',
  });
});
test('supports transcript-only notes, empty lines, literal markup, and nested sections', () => {
  const text = 'Say <beta> & "test"\r\n\r\nNot approved.';
  const nested = doc({ type: 'blockquote', content: [paragraph('My question'), transcriptNode(text)] });
  assert.deepEqual(extractMeetingSources(nested), { notes: 'My question', transcript: 'Say <beta> & "test"\n\nNot approved.' });
  assert.equal(extractMeetingSources(doc(transcriptNode(text))).notes, '');
  assert.equal(transcriptHtml(text), '<section data-transcript="true"><p>Say &lt;beta&gt; &amp; &quot;test&quot;</p><p></p><p>Not approved.</p></section>');
});
test('preserves spacing between rich-text fragments and line breaks in user notes', () => {
  assert.equal(extractMeetingSources(doc({ type: 'paragraph', content: [
    { type: 'text', text: 'Only ' }, { type: 'text', text: '12', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' interviews.' }, { type: 'hardBreak' }, { type: 'text', text: 'No decision.' },
  ] })).notes, 'Only 12 interviews.\nNo decision.');
});
