import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../chatTurn.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } });
const { runChatTurn } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function events() {
  const listeners = new Map();
  return {
    listeners,
    subscribe: async (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event); },
    emit: (event, payload) => listeners.get(event)?.(payload),
  };
}
const citations = [{ chunk_id: 14, document_id: 7, document_name: 'Planning', chunk_index: 0, chunk_preview: 'Launch on Friday.' }];

test('returns the current response citations for persistence, including late source events', async () => {
  const bus = events();
  const updates = [];
  const result = await runChatTurn(bus.subscribe, async () => {
    bus.emit('llm_response', 'Launch');
    bus.emit('llm_sources', citations);
    bus.emit('llm_response', 'Launch on Friday. [1]');
  }, update => updates.push(update));
  assert.deepEqual(result, { content: 'Launch on Friday. [1]', sources: citations });
  assert.deepEqual(updates[0], { content: 'Launch', sources: [] });
  assert.deepEqual(updates.at(-1), result);
  assert.equal(bus.listeners.size, 0);
});
test('a follow-up owns fresh citations and never reuses the previous turn', async () => {
  const bus = events();
  await runChatTurn(bus.subscribe, async () => { bus.emit('llm_sources', citations); }, () => {});
  const result = await runChatTurn(bus.subscribe, async () => { bus.emit('llm_response', 'No evidence.'); }, () => {});
  assert.deepEqual(result.sources, []);
  assert.equal(bus.listeners.size, 0);
});
test('failed requests release listeners and propagate errors instead of saving a successful reply', async () => {
  const bus = events();
  await assert.rejects(runChatTurn(bus.subscribe, async () => {
    bus.emit('llm_response', 'Partial');
    throw new Error('Connection lost');
  }, () => {}), /Connection lost/);
  assert.equal(bus.listeners.size, 0);
});
test('partial listener setup is cleaned up if the second subscription fails', async () => {
  let cleaned = false;
  await assert.rejects(runChatTurn(async event => {
    if (event === 'llm_response') throw new Error('Subscription failed');
    return () => { cleaned = true; };
  }, async () => assert.fail('Must not send'), () => {}), /Subscription failed/);
  assert.equal(cleaned, true);
});
