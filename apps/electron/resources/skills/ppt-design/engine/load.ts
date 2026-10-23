import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDeck, parseDeck } from './schema';
import type { Deck, Page, Theme } from './types';

export function skillRoot(from = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'SKILL.md')) && existsSync(join(dir, 'styles', 'catalog.json'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  throw new Error(`ppt-design skill root not found from ${from}`);
}

export function styleDirectory(styleId: string, root = skillRoot()): string {
  return join(root, 'styles', styleId);
}

export function readDeckDocument(path: string): unknown {
  if (!isAbsolute(path)) throw new Error(`deck path must be absolute: ${path}`);
  const text = readFileSync(path, 'utf8');
  if (!/\.ya?ml$/i.test(path)) return JSON.parse(text);
  try {
    const yaml = createRequire(import.meta.url)('js-yaml') as { parse: (input: string) => unknown };
    return yaml.parse(text);
  } catch {
    throw new Error('YAML decks need js-yaml; save the deck as JSON or run from the repo workspace');
  }
}

export function loadDeckFile(path: string): Deck {
  return assertDeck(readDeckDocument(path));
}

export function loadThemeFile(path: string): Theme {
  const parsed = parseDeck({
    version: 1,
    canvas: { width: 960, height: 540, unit: 'pt' },
    theme: JSON.parse(readFileSync(path, 'utf8')),
    pages: [{ id: 'probe', layout: 'cover', elements: [{ id: 't', type: 'text', bounds: [48, 48, 200, 40], text: 'probe', textCapacity: { maxLines: 2, maxCharsPerLine: 20 } }] }],
  });
  if (!parsed.deck) throw new Error(`invalid theme ${path}: ${parsed.issues.map(issue => issue.message).join('; ')}`);
  return parsed.deck.theme;
}

export function loadStyleDeck(styleId: string, root = skillRoot()): Deck {
  const dir = styleDirectory(styleId, root);
  const assembled = join(dir, 'deck.json');
  if (existsSync(assembled)) return loadDeckFile(assembled);
  const theme = loadThemeFile(join(dir, 'theme.json'));
  const pageDir = join(dir, 'pages');
  const pages = readdirSync(pageDir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => JSON.parse(readFileSync(join(pageDir, name), 'utf8')) as Page);
  return assertDeck({ version: 1, canvas: { width: 960, height: 540, unit: 'pt' }, theme, pages });
}

export function listBundledStyles(root = skillRoot()): string[] {
  return readdirSync(join(root, 'styles'))
    .filter(name => existsSync(join(root, 'styles', name, 'design.md')));
}
