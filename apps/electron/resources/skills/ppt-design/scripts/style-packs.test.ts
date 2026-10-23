import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import catalog from '../styles/catalog.json';
import { listStylePacks, resolveThumbnailPath, STYLE_IDS, stylePackIndex } from './style-packs';

describe('style pack index', () => {
  test('exposes 8-12 packs with selector fields and matching catalog ids', () => {
    const packs = listStylePacks();
    expect(packs.length).toBeGreaterThanOrEqual(8);
    expect(packs.length).toBeLessThanOrEqual(12);
    expect(packs.map(pack => pack.id).sort()).toEqual([...STYLE_IDS].sort());
    expect(Object.keys(catalog).sort()).toEqual([...STYLE_IDS].sort());
    for (const pack of packs) {
      expect(pack.name.length).toBeGreaterThan(1);
      expect(pack.nameEn.length).toBeGreaterThan(1);
      expect(pack.useCases.length).toBeGreaterThanOrEqual(2);
      expect(pack.summary.length).toBeGreaterThan(8);
      expect(pack.thumbnails.cover).toBe(`thumbnails/${pack.id}/cover.png`);
      expect(pack.thumbnails.content).toBe(`thumbnails/${pack.id}/content.png`);
      expect(pack.thumbnails.data).toBe(`thumbnails/${pack.id}/data.png`);
      expect(isAbsolute(resolveThumbnailPath(pack.id, 'cover'))).toBe(true);
    }
    expect(stylePackIndex().thumbnailKeys).toEqual(['cover', 'content', 'data']);
  });

  test('does not embed third-party company marks', () => {
    const blob = JSON.stringify({ catalog, packs: listStylePacks() });
    expect(blob).not.toMatch(/中国电信|McKinsey|McK|BCG|Bain|Apple|Google|Microsoft Logo|Tesla/i);
  });

  test('thumbnail files exist after the pack render step', () => {
    const missing = listStylePacks().flatMap(pack =>
      (['cover', 'content', 'data'] as const)
        .map(key => resolveThumbnailPath(pack.id, key))
        .filter(path => !existsSync(path)),
    );
    expect(missing).toEqual([]);
  });
});
