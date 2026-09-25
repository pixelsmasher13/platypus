import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../../../models/models.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } });
const { getConfiguredModel, MODEL_OPTIONS, DEFAULT_MODELS, effortOptions, selectedEffort, parseEffortPreferences } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const settings = { api_choice: 'claude', model_claude: '', model_openai: '', model_gemini: '' };

test('empty settings use current defaults for chat and generated documents', () => {
  assert.equal(getConfiguredModel(settings), 'claude-sonnet-5');
  assert.equal(getConfiguredModel({ ...settings, api_choice: 'openai' }), 'gpt-6-astra');
  for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
    assert.equal(getConfiguredModel({ ...settings, api_choice: provider }), model);
  }
});
test('explicit models, including older pinned IDs and custom models, remain respected', () => {
  assert.equal(getConfiguredModel({ ...settings, api_choice: 'openai', model_openai: ' gpt-6-sol ' }), 'gpt-6-sol');
  assert.equal(getConfiguredModel({ ...settings, model_claude: 'claude-sonnet-4-6' }), 'claude-sonnet-4-6');
  assert.equal(getConfiguredModel({ ...settings, model_claude: 'custom-model' }), 'custom-model');
  assert.equal(getConfiguredModel({ ...settings, model_claude: '  ' }), 'claude-sonnet-5');
});
test('every current GPT option routes to OpenAI', () => {
  assert.deepEqual(MODEL_OPTIONS.filter(m => m.provider === 'openai').map(m => m.id), ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
  assert.equal(new Set(MODEL_OPTIONS.map(m => m.id)).size, MODEL_OPTIONS.length);
});

test('effort options follow the selected model and retain independent saved choices', () => {
  const saved = { 'claude-sonnet-5': 'high', 'gpt-6-astra': 'max', 'gpt-6-luna': 'medium' };
  assert.equal(selectedEffort('claude-sonnet-5', saved), 'high');
  assert.equal(selectedEffort('gpt-6-astra', saved), 'max');
  assert.equal(selectedEffort('gpt-6-luna', saved), 'medium');
  assert.equal(selectedEffort('gpt-6-astra', { 'gpt-6-astra': 'none' }), 'low');
  assert.equal(selectedEffort('claude-sonnet-5', {}), 'none');
  assert.equal(selectedEffort('gpt-6-sol', {}), 'none');
  assert.deepEqual(effortOptions('claude-haiku-4-5'), []);
  assert.deepEqual(effortOptions('gemini-3-pro-preview'), []);
  assert.ok(!effortOptions('claude-opus-4-6').includes('xhigh'));
  assert.ok(effortOptions('claude-sonnet-5').includes('max'));
});
test('saved effort preferences survive reloads and tolerate malformed settings', () => {
  const saved = { 'claude-sonnet-5': 'high', 'gpt-6-sol': 'low' };
  assert.deepEqual(parseEffortPreferences(JSON.stringify(saved)), saved);
  for (const raw of ['', 'broken', 'null', '[]', 'false']) assert.deepEqual(parseEffortPreferences(raw), {});
  assert.deepEqual(parseEffortPreferences('{"gpt-6-astra":42}'), {});
});
