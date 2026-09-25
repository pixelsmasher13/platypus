import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Use the project's TypeScript compiler so these tests need no extra runner.
const source = readFileSync(new URL('../noteLibraryModel.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } });
const { collectNotes, selectLibraryNotes, parseLibraryPreferences } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const notes = [
  { id: 1, name: 'Sprint 10', projectName: 'Product' },
  { id: 2, name: 'Sprint 2', projectName: 'Product' },
  { id: 3, name: 'Research', projectName: 'Design' },
];
const preferences = { sort: 'newest' };
const ids = results => results.map(note => note.id);
const select = (query = '', matches = [], changes = {}) => selectLibraryNotes(notes, query, new Set(matches), { ...preferences, ...changes });

test('sorts notes without mutating source notes', () => {
  assert.deepEqual(ids(select()), [3, 2, 1]);
  assert.deepEqual(ids(select('', [], { sort: 'oldest' })), [1, 2, 3]);
  assert.deepEqual(ids(select('', [], { sort: 'title' })), [3, 2, 1]);
  assert.deepEqual(ids(notes), [1, 2, 3]);
});
test('search trims whitespace and combines title, project, and content matches', () => {
  assert.deepEqual(ids(select('  SPRINT  ')), [2, 1]);
  assert.deepEqual(ids(select(' design ')), [3]);
  assert.deepEqual(ids(select('customer', [2])), [2]);
  assert.deepEqual(ids(select('missing')), []);
  assert.deepEqual(ids(select('   ')), [3, 2, 1]);
});
test('old pin preferences cannot hide or reorder notes', () => {
  const loaded = parseLibraryPreferences(JSON.stringify({ pinnedOnly: true, pinnedIds: [1], sort: 'newest' }));
  assert.deepEqual(loaded, preferences);
  assert.deepEqual(ids(select('', [], loaded)), [3, 2, 1]);
});
test('collects project notes with readable fallback titles', () => {
  assert.deepEqual(collectNotes([{ id: 1, name: 'Work', activities: [4, 5], activity_names: ['  ', 'Plan'], activity_ids: [null, null] }]), [
    { id: 4, name: 'Untitled Note', projectName: 'Work' }, { id: 5, name: 'Plan', projectName: 'Work' },
  ]);
});
test('preferences survive round trips and tolerate malformed local storage', () => {
  const saved = { sort: 'title' };
  assert.deepEqual(parseLibraryPreferences(JSON.stringify(saved)), saved);
  for (const value of [null, 'null', '{broken']) assert.deepEqual(parseLibraryPreferences(value), preferences);
  assert.deepEqual(parseLibraryPreferences(JSON.stringify({ pinnedIds: [1, 1, -1, '2', 2.5, null], sort: 'invalid', pinnedOnly: 'true' })), preferences);
});
