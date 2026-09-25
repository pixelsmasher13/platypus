import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../slides/presentationJobs.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
const { PresentationJobs, mergePresentations } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const request = { sourceId: 42, sourceTitle: 'Original meeting', plainText: 'Full source', modelId: 'gpt-6-astra', effort: 'medium', kind: 'designed', provider: 'openai', slideCount: 2, focus: 'Leadership' };
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = [], completed = [], failures = []; let jobs = [];
  const controller = new PresentationJobs(args => new Promise((resolve, reject) => calls.push({ args, resolve, reject })), {
    changed: next => jobs = next, started: () => {}, completed: (job, deck) => completed.push({ job, deck }), failed: job => failures.push(job),
  });
  return { controller, calls, completed, failures, jobs: () => jobs };
}
test('generation survives note navigation and prevents duplicate submissions for a source', async () => {
  const h = harness(); const original = { ...request };
  assert.equal(h.controller.start(original), true);
  assert.equal(h.controller.start(original), false);
  original.sourceId = 99; original.sourceTitle = 'Another note'; original.plainText = 'Different source';
  assert.equal(h.controller.start(original), true);
  assert.equal(h.calls[0].args.plainText, 'Full source');
  h.calls[1].resolve({ id: 'second', source_id: 99 }); await turn();
  h.calls[0].resolve({ id: 'first', source_id: 42 }); await turn();
  assert.equal(h.completed[1].job.request.sourceId, 42);
  assert.equal(h.completed[1].deck.id, 'first');
  assert.equal(h.jobs().length, 0);
});
test('failure keeps the original brief and retries only once while running', async () => {
  const h = harness(); h.controller.start(request);
  h.calls[0].reject('Network failed'); await turn();
  const failed = h.jobs()[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'Network failed');
  h.controller.retry(failed.id); h.controller.retry(failed.id);
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].args, request);
  h.calls[1].resolve({ id: 'saved' }); await turn();
  assert.equal(h.jobs().length, 0); assert.equal(h.completed.length, 1);
});
test('a late library read retains decks that finished while it was loading', () => {
  const newer = { id: 'new', created_at: '2026-09-25T12:00:00Z' };
  const older = { id: 'old', created_at: '2026-09-24T12:00:00Z' };
  assert.deepEqual(mergePresentations([newer], [older]), [newer, older]);
  assert.equal(mergePresentations([older], [{ ...older, title: 'Edited' }])[0].title, 'Edited');
});
