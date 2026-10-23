#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_IDS, buildStyleDeck } from '../engine/library/catalog';

const root = resolve(fileURLToPath(import.meta.url), '../../styles');

for (const style of STYLE_IDS) {
  const deck = buildStyleDeck(style);
  const dir = join(root, style);
  mkdirSync(join(dir, 'pages'), { recursive: true });
  writeFileSync(join(dir, 'theme.json'), `${JSON.stringify(deck.theme, null, 2)}\n`);
  writeFileSync(join(dir, 'deck.json'), `${JSON.stringify(deck, null, 2)}\n`);
  deck.pages.forEach((page, index) => {
    writeFileSync(join(dir, 'pages', `${String(index + 1).padStart(2, '0')}-${page.id}.json`), `${JSON.stringify(page, null, 2)}\n`);
  });
  console.log(`wrote ${style}: ${deck.pages.length} pages`);
}
