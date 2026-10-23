#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STYLE_IDS, buildStyleDeck } from '../engine/library/catalog';
import { writePagePreviews } from '../engine/preview';
import { renderDeck } from '../engine/export-pptx';
import { checkDeck } from '../engine/check';

const outRoot = process.argv[2] && process.argv[2].startsWith('/')
  ? process.argv[2]
  : '/opt/cursor/artifacts/ppt-declarative-engine';

mkdirSync(outRoot, { recursive: true });

for (const style of STYLE_IDS) {
  const deck = buildStyleDeck(style);
  const report = checkDeck(deck);
  if (!report.ok) throw new Error(`${style} failed check:\n${JSON.stringify(report.issues, null, 2)}`);
  const dir = join(outRoot, style);
  mkdirSync(dir, { recursive: true });
  const preview = await writePagePreviews(deck, dir);
  const pptxDir = join(dir, 'pptx');
  mkdirSync(pptxDir, { recursive: true });
  const rendered = await renderDeck(deck, join(pptxDir, `${style}.pptx`), pptxDir);
  console.log(JSON.stringify({ style, check: report.ok, preview, rendered }, null, 2));
}

const sheets = STYLE_IDS.map(style => join(outRoot, style, 'contact-sheet.png'));
try {
  const sharp = (await import('sharp')).default;
  const buffers = await Promise.all(sheets.map(file => sharp(file).png().toBuffer()));
  const metas = await Promise.all(buffers.map(buffer => sharp(buffer).metadata()));
  const width = Math.max(...metas.map(meta => meta.width ?? 1920));
  let top = 0;
  const stacked = buffers.map((input, index) => {
    const height = metas[index]?.height ?? 810;
    const item = { input, left: 0, top };
    top += height + 24;
    return item;
  });
  const combined = join(outRoot, 'contact-sheets.png');
  await sharp({
    create: { width, height: top - 24, channels: 3, background: '#111111' },
  }).composite(stacked).png().toFile(combined);
  console.log(JSON.stringify({ outRoot, sheets, combined }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ outRoot, sheets, combineError: error instanceof Error ? error.message : String(error) }, null, 2));
}
