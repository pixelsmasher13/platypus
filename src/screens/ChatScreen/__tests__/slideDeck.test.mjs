import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import JSZip from 'jszip';
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`;
const modelUrl = moduleUrl(readFileSync(new URL('../slides/slideDeck.ts', import.meta.url), 'utf8'));
const { validateSlides, slideIssues, slidesToMarkdown, slideScene, DECK_WIDTH, DECK_HEIGHT } = await import(modelUrl);
const exportSource = readFileSync(new URL('../slides/exportPowerPoint.ts', import.meta.url), 'utf8')
  .replace("'./slideDeck'", JSON.stringify(modelUrl)).replace("'pptxgenjs'", JSON.stringify(import.meta.resolve('pptxgenjs')));
const { createPowerPoint } = await import(moduleUrl(exportSource));
const slides = [
  { title: 'A clearer path to launch', bullets: ['Release readiness from the product review'], layout: 'title', speaker_notes: 'Source: the product review. The release date is not final.' },
  { title: 'Two blockers remain', bullets: ['Search needs one more round of testing.', 'The customer announcement needs an owner.'], layout: 'content', speaker_notes: 'Alex owns testing. The team has not assigned the announcement.' },
  { title: 'Release sequence', bullets: ['Alex completes the test run.', 'The team reviews the results.', 'The release owner makes the launch decision.'], layout: 'steps', speaker_notes: 'Keep this sequence. Do not imply approval is already granted.' },
  { title: 'Readiness depends on the test results', bullets: ['The launch decision follows the team review.'], layout: 'takeaway', speaker_notes: 'No date has been promised.' },
];

test('validates provider results and supports older bullet-only responses', () => {
  assert.equal(validateSlides([{ title: ' Plan ', bullets: [' One ', ''] }])[0].layout, 'title');
  assert.deepEqual(validateSlides([{ title: 'Plan', bullets: [' One ', ''] }])[0].bullets, ['One']);
  for (const invalid of [[], null, [{ title: ' ', bullets: [] }], [{ title: 'Plan', bullets: [42] }]]) assert.throws(() => validateSlides(invalid));
});
test('flags crowded slides and empty content without truncating it', () => {
  for (const slide of slides) assert.deepEqual(slideIssues(slide), [], slide.title);
  assert.ok(slideIssues({ ...slides[0], bullets: ['one', 'two'] }).length);
  assert.ok(slideIssues({ ...slides[1], bullets: ['W'.repeat(150)] }).some(issue => issue.includes('dense')));
  assert.ok(slideIssues({ ...slides[1], bullets: [] }).length);
  assert.ok(slideIssues({ ...slides[1], title: 'a'.repeat(101) }).length);
});
test('preview and export scenes stay inside widescreen bounds', () => {
  slides.forEach((slide, index) => slideScene(slide, index, slides.length).text.forEach(item => {
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= DECK_WIDTH && item.y + item.h <= DECK_HEIGHT);
  }));
});
test('Markdown includes Marp metadata and keeps presenter notes off-slide', () => {
  const markdown = slidesToMarkdown(slides);
  assert.match(markdown, /marp: true/);
  assert.match(markdown, /<!--\nSource: the product review/);
  assert.ok(!markdown.includes('> Source:'));
});
test('PowerPoint contains editable text, all slides, and separate speaker notes', async () => {
  const bytes = await createPowerPoint(slides);
  const zip = await JSZip.loadAsync(bytes);
  const pages = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path));
  assert.equal(pages.length, slides.length);
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /A clearer path to launch/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /release date is not final/);
  assert.ok(!(await zip.file('ppt/slides/slide1.xml').async('string')).includes('release date is not final'));
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /cx="12192000" cy="6858000"/);
  if (process.env.SLIDE_TEST_OUTPUT) writeFileSync(process.env.SLIDE_TEST_OUTPUT, bytes);
});
test('PowerPoint refuses empty and overcrowded decks', async () => {
  await assert.rejects(createPowerPoint([]), /at least one/);
  await assert.rejects(createPowerPoint([{ ...slides[1], bullets: Array(8).fill('Too many points') }]), /Slide 1/);
});
