import { describe, expect, test } from 'bun:test';
import { checkDeck } from './check';
import { buildNavyBriefDeck } from './library/navy-brief';
import { buildSwissSignalDeck } from './library/swiss-signal';
import { measureUnits, neededLines, wrapLines } from './text';
import type { Deck, TextElement } from './types';

function textOn(deck: Deck, patch: Partial<TextElement>): Deck {
  const next = structuredClone(deck);
  const page = next.pages[1];
  const text = page.elements.find(element => element.type === 'text') as TextElement;
  Object.assign(text, patch);
  return next;
}

describe('deck_check', () => {
  test('CJK fullwidth characters consume more width than Latin', () => {
    expect(measureUnits('字')).toBeGreaterThan(measureUnits('i'));
    expect(neededLines('，，，，', 2 * 18, 18)).toBe(2);
    expect(wrapLines('一二三四五六七八', 4 * 18, 18).length).toBeGreaterThan(1);
  });

  test('reports every defect in one pass with page and element ids', () => {
    const deck = textOn(buildSwissSignalDeck(), {
      text: '字\\n孤',
      bounds: [940, 520, 80, 12],
      style: { size: 18, color: '#F5F3EE' },
      textCapacity: { maxLines: 1, maxCharsPerLine: 2 },
    });
    const peer = deck.pages[1].elements.find(element => element.type === 'text' && element.id !== deck.pages[1].elements.find(item => item.type === 'text')?.id);
    if (peer && peer.type === 'text') {
      const first = deck.pages[1].elements.find(element => element.type === 'text') as TextElement;
      peer.bounds = first.bounds;
    }
    const report = checkDeck(deck);
    expect(report.ok).toBe(false);
    const codes = new Set(report.issues.map(issue => issue.code));
    expect(codes.has('out_of_bounds')).toBe(true);
    expect(codes.has('literal_newline')).toBe(true);
    expect(codes.has('over_capacity') || codes.has('orphan')).toBe(true);
    expect(report.issues.every(issue => issue.pageId)).toBe(true);
  });

  test('flags adjacent repeated layouts and low contrast', () => {
    const deck = structuredClone(buildNavyBriefDeck());
    deck.pages[2].layout = deck.pages[1].layout;
    const text = deck.pages[1].elements.find(element => element.type === 'text') as TextElement;
    text.style = { ...text.style, color: '#172033' };
    const report = checkDeck(deck);
    expect(report.issues.some(issue => issue.code === 'adjacent_layout')).toBe(true);
    expect(report.issues.some(issue => issue.code === 'contrast')).toBe(true);
  });

  test('both bundled styles pass a full check', () => {
    expect(checkDeck(buildSwissSignalDeck())).toEqual({ ok: true, issues: [] });
    expect(checkDeck(buildNavyBriefDeck())).toEqual({ ok: true, issues: [] });
  });
});
