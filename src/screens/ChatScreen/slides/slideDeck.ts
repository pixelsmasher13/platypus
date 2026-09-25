export type SlideLayout = 'title' | 'content' | 'steps' | 'takeaway';
export type Slide = { title: string; bullets: string[]; speaker_notes?: string; layout?: SlideLayout };
export const SLIDE_LAYOUTS: SlideLayout[] = ['title', 'content', 'steps', 'takeaway'];

export function validateSlides(value: unknown): Slide[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error('The model did not return a usable deck. Try a smaller slide count.');
  return value.map((item, index) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() ||
        !Array.isArray(item.bullets) || item.bullets.some((bullet: unknown) => typeof bullet !== 'string')) {
      throw new Error(`Slide ${index + 1} is incomplete. Please generate again.`);
    }
    return {
      title: item.title.trim(), bullets: item.bullets.map((bullet: string) => bullet.trim()).filter(Boolean),
      speaker_notes: typeof item.speaker_notes === 'string' ? item.speaker_notes.trim() : '',
      layout: SLIDE_LAYOUTS.includes(item.layout) ? item.layout : index === 0 ? 'title' : 'content',
    };
  });
}

export function slideIssues(slide: Slide): string[] {
  const issues: string[] = [];
  const layout = slide.layout || 'content';
  if (!slide.title.trim()) issues.push('Add a title.');
  if (slide.title.includes('\n')) issues.push('Keep the title on one paragraph.');
  if (slide.bullets.some(point => !point.trim())) issues.push('Remove empty point lines.');
  if (slide.title.length > 100) issues.push('Shorten the title to 100 characters or fewer.');
  const maxPoints = layout === 'title' || layout === 'takeaway' ? 1 : 4;
  if (slide.bullets.length > maxPoints) issues.push(`Use at most ${maxPoints} ${maxPoints === 1 ? 'supporting line' : 'points'} in this layout. Move detail to speaker notes.`);
  if (slide.bullets.some(point => point.length > 160 || point.includes('\n'))) issues.push('Keep each point to one paragraph and 160 characters or fewer.');
  if (!slide.bullets.some(point => point.trim()) && layout !== 'title') issues.push('Add at least one supporting point.');
  if (slideScene(slide, 0, 1).text.some(item => estimatedLines(item.text, item.w * 72, item.size) * item.size * 1.2 > item.h * 72 + 1)) {
    issues.push('Text is too dense for this layout. Shorten it or move detail to speaker notes.');
  }
  return issues;
}

// Conservative wrapping estimate also catches unusually wide words and long URLs.
function estimatedLines(text: string, width: number, size: number): number {
  const measure = (word: string) => Array.from(word).reduce((sum, char) => sum +
    (/[MW@%]/.test(char) ? .95 : /[il.,!:;'|]/.test(char) ? .3 : /[A-Z]/.test(char) ? .72 : char.charCodeAt(0) > 255 ? 1 : .58) * size, 0);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const wordWidth = measure(word);
    if (used && used + size * .3 + wordWidth > width) { lines += 1; used = 0; }
    if (wordWidth > width) {
      lines += Math.floor(wordWidth / width);
      used = wordWidth % width;
    } else used += (used ? size * .3 : 0) + wordWidth;
  }
  return lines;
}

export function slidesToMarkdown(slides: Slide[]): string {
  return '---\nmarp: true\nsize: 16:9\npaginate: true\n---\n\n' + slides.map(slide =>
    `# ${slide.title}\n\n${slide.bullets.map(point => `- ${point}`).join('\n')}${slide.speaker_notes ? `\n\n<!--\n${slide.speaker_notes.replace(/-->/g, '—>')}\n-->` : ''}`
  ).join('\n\n---\n\n');
}

export type SlideText = { text: string; x: number; y: number; w: number; h: number; size: number; color: string; bold?: boolean };
export const DECK_WIDTH = 13.333333;
export const DECK_HEIGHT = 7.5;

/** One layout specification powers both the preview and editable PowerPoint export. */
export function slideScene(slide: Slide, index: number, total: number): { background: string; text: SlideText[] } {
  const hero = slide.layout === 'title' || slide.layout === 'takeaway';
  const background = hero ? '153C3B' : 'F8F7F3';
  const ink = hero ? 'FFFFFF' : '172F2E';
  const muted = hero ? 'BFD8D2' : '58706D';
  const text: SlideText[] = [];
  text.push({ text: slide.layout === 'takeaway' ? 'KEY TAKEAWAY' : 'PLATYPUS NOTES', x: .75, y: .5, w: 9, h: .3, size: 11, color: muted, bold: true });
  text.push({ text: slide.title, x: .75, y: hero ? 2 : 1.05, w: 11.8, h: hero ? 2.2 : 1.4, size: hero ? 42 : 32, color: ink, bold: true });
  slide.bullets.forEach((point, i) => {
    const y = hero ? 4.5 + i * .7 : 2.85 + i * .87;
    if (!hero) text.push({ text: slide.layout === 'steps' ? String(i + 1).padStart(2, '0') : '•', x: .8, y, w: .55, h: .75, size: 22, color: '33827A', bold: true });
    text.push({ text: point, x: hero ? .8 : 1.5, y, w: hero ? 11.4 : 10.9, h: hero ? 1.35 : .8, size: hero ? 24 : 23, color: hero ? muted : ink });
  });
  text.push({ text: `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, x: 11.6, y: 6.95, w: 1, h: .25, size: 10, color: muted });
  return { background, text };
}
