import { describe, expect, test } from 'bun:test';
import { parseDeck, assertDeck } from './schema';
import { buildSwissSignalDeck } from './library/swiss-signal';

describe('deck schema', () => {
  test('accepts a complete reference deck', () => {
    const deck = assertDeck(buildSwissSignalDeck());
    expect(deck.canvas).toEqual({ width: 960, height: 540, unit: 'pt' });
    expect(deck.pages).toHaveLength(12);
    expect(deck.pages[0].elements[0]?.bounds).toHaveLength(4);
  });

  test('rejects the wrong canvas and unknown fields of the wrong type', () => {
    const base = buildSwissSignalDeck();
    expect(parseDeck({ ...base, canvas: { width: 1920, height: 1080, unit: 'px' } }).issues.length).toBeGreaterThan(0);
    expect(parseDeck({ ...base, version: 2 }).issues.some(issue => issue.path === 'version')).toBe(true);
    const broken = structuredClone(base);
    (broken.pages[0].elements[0] as { bounds: unknown }).bounds = [1, 2];
    expect(parseDeck(broken).issues.some(issue => issue.message.includes('[x,y,w,h]'))).toBe(true);
  });

  test('rejects a chart whose series length drifts from categories', () => {
    const deck = structuredClone(buildSwissSignalDeck());
    const chart = deck.pages.find(page => page.elements.some(element => element.type === 'chart'));
    const element = chart?.elements.find(item => item.type === 'chart');
    expect(element?.type).toBe('chart');
    if (element?.type === 'chart') element.chart.series[0].values = [1];
    expect(parseDeck(deck).issues.some(issue => issue.message.includes('series length'))).toBe(true);
  });
});
