import { Box } from '@chakra-ui/react';
import { DECK_HEIGHT, DECK_WIDTH, slideScene, type Slide } from './slideDeck';

export function SlidePreview({ slide, index, total }: { slide: Slide; index: number; total: number }) {
  const scene = slideScene(slide, index, total);
  return <Box role="img" aria-label={`Slide ${index + 1}: ${slide.title}`} position="relative" aspectRatio="16 / 9"
    bg={`#${scene.background}`} borderRadius="md" overflow="hidden" sx={{ containerType: 'inline-size' }}>
    {scene.text.map((item, i) => <Box key={i} position="absolute"
      left={`${item.x / DECK_WIDTH * 100}%`} top={`${item.y / DECK_HEIGHT * 100}%`}
      width={`${item.w / DECK_WIDTH * 100}%`} height={`${item.h / DECK_HEIGHT * 100}%`}
      fontFamily="Arial, sans-serif" fontSize={`${item.size / (DECK_WIDTH * 72) * 100}cqw`}
      lineHeight="1.15" color={`#${item.color}`} fontWeight={item.bold ? 700 : 400} overflowWrap="anywhere">{item.text}</Box>)}
  </Box>;
}
