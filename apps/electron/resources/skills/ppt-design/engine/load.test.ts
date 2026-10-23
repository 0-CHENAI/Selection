import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkDeck } from './check';
import { loadStyleDeck, listBundledStyles, skillRoot } from './load';

describe('bundled style files', () => {
  test('disk decks match the two shipped styles and pass check', () => {
    const root = skillRoot();
    expect(listBundledStyles(root).sort()).toEqual(['navy-brief', 'swiss-signal']);
    for (const id of ['swiss-signal', 'navy-brief']) {
      const deck = loadStyleDeck(id, root);
      expect(deck.theme.id).toBe(id);
      expect(deck.pages).toHaveLength(12);
      expect(checkDeck(deck).ok).toBe(true);
      expect(join(root, 'styles', id, 'design.md')).toBeTruthy();
    }
  });
});
