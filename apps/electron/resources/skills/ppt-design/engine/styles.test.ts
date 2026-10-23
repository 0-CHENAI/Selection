import { describe, expect, test } from 'bun:test';
import { checkDeck } from './check';
import { STYLE_IDS, buildStyleDeck } from './library/catalog';
import { LAYOUT_IDS } from './types';

describe('bundled styles', () => {
  test('each style has twelve argument pages, unique covers, and no adjacent repeats', () => {
    const signatures = STYLE_IDS.map(id => {
      const deck = buildStyleDeck(id);
      expect(checkDeck(deck).ok).toBe(true);
      expect(deck.pages).toHaveLength(12);
      expect(deck.pages.map(page => page.layout)).toEqual([...LAYOUT_IDS]);
      deck.pages.forEach((page, index) => {
        if (index) expect(page.layout).not.toBe(deck.pages[index - 1].layout);
        expect(page.elements.some(element => element.type === 'text')).toBe(true);
        expect(page.source?.includes('示例') || page.notes?.includes('示例')).toBe(true);
      });
      const cover = deck.pages[0];
      return {
        id,
        bg: cover.background ?? deck.theme.palette.background,
        accent: deck.theme.palette.accent,
        first: cover.elements.filter(element => element.type === 'shape').map(element => element.bounds.join(',')).join('|'),
      };
    });
    expect(new Set(signatures.map(item => item.bg)).size).toBe(STYLE_IDS.length);
    expect(new Set(signatures.map(item => item.accent)).size).toBe(STYLE_IDS.length);
    expect(new Set(signatures.map(item => item.first)).size).toBe(STYLE_IDS.length);
  });
});
