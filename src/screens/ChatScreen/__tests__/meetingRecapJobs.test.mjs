import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../meetingRecapJobs.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
const { MeetingRecapJobs } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const request = { sourceId: 42, sourceTitle: 'Original meeting', projectId: 7, sources: { notes: 'My priorities', transcript: 'Original transcript' }, provider: 'claude', modelId: 'claude-sonnet-5' };
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = [], ready = [], failed = [];
  const controller = new MeetingRecapJobs(args => new Promise((resolve, reject) => calls.push({ args, resolve, reject })), {
    changed: () => {}, started: () => {}, completed: job => ready.push(job), failed: job => failed.push(job),
  });
  return { controller, calls, ready, failed };
}
test('background recaps retain original sources and project while other notes generate', async () => {
  const h = harness(); const original = { ...request, sources: { ...request.sources } };
  assert.equal(h.controller.start(original), true);
  assert.equal(h.controller.start(original), false);
  original.sources.transcript = 'Later edits'; original.projectId = 99;
  h.controller.dismiss(42); // Closing UI cannot remove a running request.
  assert.equal(h.controller.get(42).status, 'running');
  h.controller.start({ ...request, sourceId: 99, sourceTitle: 'Second meeting' });
  h.calls[1].resolve('Second recap'); await turn();
  h.calls[0].resolve('Original recap'); await turn();
  const draft = h.controller.get(42).draft;
  assert.equal(draft.sources.transcript, 'Original transcript');
  assert.equal(draft.projectId, 7);
  assert.equal(draft.markdown, 'Original recap');
  assert.equal(h.controller.get(99).draft.markdown, 'Second recap');
});
test('ready drafts keep edits for later review and cannot be silently overwritten', async () => {
  const h = harness(); h.controller.start(request); h.calls[0].resolve('Draft'); await turn();
  const edited = { ...h.controller.get(42).draft, title: 'Edited title', markdown: 'Edited recap' };
  h.controller.update(42, edited);
  assert.equal(h.controller.start(request), false);
  assert.deepEqual(h.controller.get(42).draft, edited);
  h.controller.dismiss(42);
  assert.equal(h.controller.start(request), true);
});
test('failure retains inputs and retry is guarded against double submissions', async () => {
  const h = harness(); h.controller.start(request); h.calls[0].reject('Network failed'); await turn();
  assert.equal(h.controller.get(42).status, 'failed');
  h.controller.retry(42); h.controller.retry(42);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].args, request);
  h.calls[1].resolve('Recovered recap'); await turn();
  assert.equal(h.controller.get(42).status, 'ready');
  assert.equal(h.ready.length, 1);
});
test('empty output is a retryable failure rather than a ready draft', async () => {
  const h = harness(); h.controller.start(request); h.calls[0].resolve('  '); await turn();
  assert.equal(h.ready.length, 0);
  assert.match(h.failed[0].error, /empty draft/);
  assert.equal(h.controller.get(42).draft, undefined);
});
