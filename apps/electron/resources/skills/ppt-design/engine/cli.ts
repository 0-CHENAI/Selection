import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { checkDeck } from './check';
import { renderDeck } from './export-pptx';
import { loadDeckFile, loadStyleDeck, skillRoot } from './load';
import { STYLE_IDS, buildStyleDeck } from './library/catalog';
import { writePagePreviews } from './preview';
import type { Deck } from './types';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireAbs(value: string | undefined, name: string): string {
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function load(args: string[]): Deck {
  const style = flag(args, '--style');
  const deck = flag(args, '--deck');
  if (style) return loadStyleDeck(style, skillRoot());
  return loadDeckFile(requireAbs(deck, '--deck'));
}

export async function run(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || args.includes('--help')) {
    console.log(JSON.stringify({
      usage: [
        'deck.js check --deck /ABS/deck.json',
        'deck.js render --deck /ABS/deck.json --out /ABS/deck.pptx --folder /ABS/dataFolder',
        'deck.js preview --deck /ABS/deck.json --out-dir /ABS/previews',
        'deck.js pages --style swiss-signal --out-dir /ABS/style-dir',
      ],
      styles: STYLE_IDS,
    }, null, 2));
    return 0;
  }
  if (command === 'check') {
    const report = checkDeck(load(args));
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 2;
  }
  if (command === 'render') {
    const deck = load(args);
    const out = requireAbs(flag(args, '--out'), '--out');
    const folder = requireAbs(flag(args, '--folder') ?? dirname(out), '--folder');
    const result = await renderDeck(deck, out, folder);
    console.log(JSON.stringify(result, null, 2));
    if (result.outcome === 'needs_revision') return 2;
    const previewDir = flag(args, '--preview-dir');
    if (previewDir) {
      if (!isAbsolute(previewDir)) throw new Error('--preview-dir must be absolute');
      await writePagePreviews(deck, previewDir);
    }
    return 0;
  }
  if (command === 'preview') {
    const deck = load(args);
    const report = checkDeck(deck);
    if (!report.ok) {
      console.log(JSON.stringify({ outcome: 'needs_revision', issues: report.issues }, null, 2));
      return 2;
    }
    const outDir = requireAbs(flag(args, '--out-dir'), '--out-dir');
    const written = await writePagePreviews(deck, outDir);
    console.log(JSON.stringify({ outcome: 'PREVIEWED', ...written }, null, 2));
    return 0;
  }
  if (command === 'pages') {
    const style = flag(args, '--style');
    if (!style) throw new Error('--style is required');
    const deck = buildStyleDeck(style);
    const outDir = requireAbs(flag(args, '--out-dir'), '--out-dir');
    mkdirSync(join(outDir, 'pages'), { recursive: true });
    writeFileSync(join(outDir, 'theme.json'), `${JSON.stringify(deck.theme, null, 2)}\n`);
    writeFileSync(join(outDir, 'deck.json'), `${JSON.stringify(deck, null, 2)}\n`);
    deck.pages.forEach((page, index) => {
      writeFileSync(join(outDir, 'pages', `${String(index + 1).padStart(2, '0')}-${page.id}.json`), `${JSON.stringify(page, null, 2)}\n`);
    });
    console.log(JSON.stringify({ outcome: 'WROTE_PAGES', style, pages: deck.pages.length, outDir }, null, 2));
    return 0;
  }
  throw new Error(`unknown command ${command}`);
}
