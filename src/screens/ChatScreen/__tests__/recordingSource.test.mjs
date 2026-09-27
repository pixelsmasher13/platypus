import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../../../components/recordingSource.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } });
const { preferredRecordingSource, effectiveRecordingSource, recordingSourceNames } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('settings switches map to the three recorder sources, microphone-only off macOS', () => {
  assert.equal(preferredRecordingSource({ record_meeting_audio: true, record_microphone: true }, true), 'both');
  assert.equal(preferredRecordingSource({ record_meeting_audio: false, record_microphone: true }, true), 'microphone');
  assert.equal(preferredRecordingSource({ record_meeting_audio: true, record_microphone: false }, true), 'system');
  assert.equal(preferredRecordingSource({ record_meeting_audio: false, record_microphone: false }, true), 'microphone');
  assert.equal(preferredRecordingSource({ record_meeting_audio: true, record_microphone: true }, false), 'microphone');
});
test('missing macOS permission falls back to the microphone only when meeting audio was wanted', () => {
  assert.equal(effectiveRecordingSource('both', false), 'microphone');
  assert.equal(effectiveRecordingSource('system', false), 'microphone');
  assert.equal(effectiveRecordingSource('both', true), 'both');
  assert.equal(effectiveRecordingSource('both', null), 'both');
  assert.equal(effectiveRecordingSource('microphone', false), 'microphone');
  assert.deepEqual(Object.keys(recordingSourceNames).sort(), ['both', 'microphone', 'system']);
});
