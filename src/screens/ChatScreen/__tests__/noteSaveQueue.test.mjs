import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../noteSaveQueue.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
const { enqueueNoteSave } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('a background result checks the source after the last pending user autosave', async () => {
  let persisted = 'raw transcript', finish;
  const pendingSave = enqueueNoteSave(42, async () => { await new Promise(resolve => { finish = resolve; }); persisted = 'my new notes'; });
  const recap = enqueueNoteSave(42, async () => {
    if (persisted !== 'raw transcript') return false;
    persisted = 'generated summary'; return true;
  });
  assert.equal(await enqueueNoteSave(99, async () => 'independent note'), 'independent note');
  finish(); await pendingSave;
  assert.equal(await recap, false);
  assert.equal(persisted, 'my new notes');
});
test('failed saves do not poison subsequent writes', async () => {
  await assert.rejects(enqueueNoteSave(1, async () => { throw new Error('Disk full'); }), /Disk full/);
  assert.equal(await enqueueNoteSave(1, async () => 'retry'), 'retry');
});
