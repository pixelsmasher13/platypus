import { slideIssues, slideScene, type Slide } from './slideDeck';

export async function createPowerPoint(slides: Slide[]): Promise<Uint8Array> {
  if (!slides.length) throw new Error('Add at least one slide.');
  const invalid = slides.findIndex(slide => slideIssues(slide).length > 0);
  if (invalid >= 0) throw new Error(`Slide ${invalid + 1}: ${slideIssues(slides[invalid])[0]}`);
  // Load only when exporting; the presentation engine stays out of the main app bundle.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Platypus Notes';
  deck.subject = 'Generated from your notes';
  deck.title = slides[0].title;
  deck.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' };
  slides.forEach((slide, index) => {
    const page = deck.addSlide();
    const scene = slideScene(slide, index, slides.length);
    page.background = { color: scene.background };
    scene.text.forEach(item => page.addText(item.text, {
      x: item.x, y: item.y, w: item.w, h: item.h, fontSize: item.size,
      color: item.color, bold: item.bold, fontFace: 'Arial', margin: 0,
      breakLine: false, valign: 'top', paraSpaceAfter: 0,
    }));
    if (slide.speaker_notes) page.addNotes(slide.speaker_notes);
  });
  const buffer = await deck.write({ outputType: 'arraybuffer', compression: true });
  return new Uint8Array(buffer as ArrayBuffer);
}
