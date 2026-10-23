import { describe, expect, test } from 'bun:test';
import { pageToSvg, previewFontFamily } from './preview';
import { buildNavyBriefDeck } from './library/navy-brief';
import { buildSwissSignalDeck } from './library/swiss-signal';

describe('svg preview serialization', () => {
  test('quotes font-family so librsvg does not truncate the attribute', () => {
    const family = previewFontFamily();
    expect(family.startsWith("'WenQuanYi Micro Hei'")).toBe(true);
    expect(family.includes('"')).toBe(false);
    const svg = pageToSvg(buildSwissSignalDeck(), buildSwissSignalDeck().pages[0]);
    expect(svg.includes(`font-family="${family}"`)).toBe(true);
    expect(svg.includes("font-family=''")).toBe(false);
    expect(svg.includes('从投放获客')).toBe(true);
  });

  test('renders waterfall as hidden-base columns and navy cover as a distinct composition', () => {
    const swiss = buildSwissSignalDeck();
    const waterfall = swiss.pages.find(page => page.id === 'waterfall');
    expect(waterfall).toBeTruthy();
    const svg = pageToSvg(swiss, waterfall!);
    expect(svg.includes('<rect')).toBe(true);
    expect(svg.includes('基期')).toBe(true);
    const navyCover = pageToSvg(buildNavyBriefDeck(), buildNavyBriefDeck().pages[0]);
    expect(navyCover.includes('把不确定性')).toBe(true);
    expect(navyCover.includes('2.7')).toBe(false);
  });
});
