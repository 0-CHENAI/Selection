import { buildNavyBriefDeck } from './navy-brief';
import { buildSwissSignalDeck } from './swiss-signal';
import type { Deck } from '../types';

export const STYLE_BUILDERS: Record<string, () => Deck> = {
  'swiss-signal': buildSwissSignalDeck,
  'navy-brief': buildNavyBriefDeck,
};

export function buildStyleDeck(styleId: string): Deck {
  const build = STYLE_BUILDERS[styleId];
  if (!build) throw new Error(`unknown style ${styleId}; expected ${Object.keys(STYLE_BUILDERS).join('|')}`);
  return build();
}

export const STYLE_IDS = Object.keys(STYLE_BUILDERS);
