import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../styles/catalog.json';
import index from '../styles/index.json';

export const STYLE_PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export type StyleId = keyof typeof catalog;
export const STYLE_IDS = Object.keys(catalog) as StyleId[];

export type StyleThumbnailKey = 'cover' | 'content' | 'data';

export type StylePackIndexEntry = {
  id: StyleId;
  name: string;
  nameEn: string;
  useCases: string[];
  summary: string;
  thumbnails: Record<StyleThumbnailKey, string>;
};

type IndexFile = {
  version: 1;
  canvas: { widthCm: number; heightCm: number };
  thumbnailKeys: StyleThumbnailKey[];
  styles: StylePackIndexEntry[];
};

export function stylePackIndex(): IndexFile {
  return index as IndexFile;
}

export function listStylePacks(): StylePackIndexEntry[] {
  return stylePackIndex().styles;
}

export function getStylePack(id: string): StylePackIndexEntry {
  const entry = listStylePacks().find(item => item.id === id);
  if (!entry) throw new Error(`unknown style pack: ${id}`);
  return entry;
}

export function resolveThumbnailPath(id: string, key: StyleThumbnailKey): string {
  const relative = getStylePack(id).thumbnails[key];
  if (!relative || isAbsolute(relative) || relative.includes('..')) {
    throw new Error(`thumbnail path must be a skill-relative file: ${id}/${key}`);
  }
  return join(STYLE_PACK_ROOT, relative);
}
