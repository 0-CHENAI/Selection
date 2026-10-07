/** Content-addressed original/extraction store. A directory index is navigation, never read evidence. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface SourceUnit { id: string; label: string; kind: 'section' | 'page' | 'paragraph' | 'cell' | 'slide'; startLine: number; endLine: number }
export interface SourceSnapshot {
  indexHash: string; schema: 1; extractor: 'selection-original-v1'; version: string; originalHash: string; textHash: string;
  originalPath: string; textPath: string; origin: string; format: string; acquiredAt: string;
  units: SourceUnit[]; limitations: string[]; acquisition?: { toolCallId: string; sessionId: string; requestedUrl: string; finalUrl: string; contentType: string };
}
export const sourceHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function insideSourceDirectory(path: string, directory: string): boolean {
  const rel = relative(realpathSync(directory), realpathSync(path));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const snapshotKey = (originalHash: string, origin: string) => sourceHash(`${originalHash}\0${origin}\0selection-original-v1`);
export function sourceIndexPath(directory: string, originalPath: string): string {
  const path = realpathSync(resolve(directory, originalPath));
  if (!insideSourceDirectory(path, directory)) throw new Error('Original leaves the authorized directory');
  return join(directory, '.selection-sources', snapshotKey(sourceHash(readFileSync(path)), path), 'index.json');
}
export function saveSourceSnapshot(directory: string, original: Uint8Array, origin: string, format: string,
  parts: Array<{ id: string; label: string; kind: SourceUnit['kind']; text: string }>, limitations: string[],
  acquisition?: SourceSnapshot['acquisition'], originalPath?: string): SourceSnapshot {
  const version = snapshotKey(sourceHash(original), origin);
  const target = join(realpathSync(directory), '.selection-sources', version);
  const store = dirname(target);
  mkdirSync(store, { recursive: true });
  if (!insideSourceDirectory(store, directory)) throw new Error('Source store leaves the authorized directory');
  let line = 1;
  const units = parts.map(part => { const startLine = line; line += part.text.split('\n').length; return { id: part.id, label: part.label, kind: part.kind, startLine, endLine: line - 1 }; });
  const text = parts.map(part => part.text).join('\n');
  const snapshot: SourceSnapshot = { indexHash: '', schema: 1, extractor: 'selection-original-v1', version,
    originalHash: sourceHash(original), textHash: sourceHash(text), originalPath: originalPath ?? join(target, 'original'),
    textPath: join(target, 'snapshot.txt'), origin, format, acquiredAt: new Date().toISOString(), units, limitations, acquisition };
  // Immutable bytes; a repeat fetch cannot rewrite acquisition identity or an index already referenced by a run.
  const manifest = join(target, 'index.json');
  if (existsSync(manifest)) { const existing = readSourceSnapshot(manifest, directory); if (existing) return existing; throw new Error('Existing source index is corrupt'); }
  snapshot.indexHash = sourceHash(JSON.stringify({ ...snapshot, indexHash: '' }));
  const stage = mkdtempSync(join(store, '.preparing-'));
  try {
    writeFileSync(join(stage, 'original'), original);
    writeFileSync(join(stage, 'snapshot.txt'), text);
    writeFileSync(join(stage, 'index.json'), JSON.stringify(snapshot));
    try { renameSync(stage, target); } catch (error) {
      const existing = readSourceSnapshot(manifest, directory);
      if (existing) return existing;
      throw error;
    }
    return snapshot;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
export function readSourceSnapshot(manifest: string, directory: string): SourceSnapshot | undefined {
  try {
    if (!insideSourceDirectory(manifest, directory)) return undefined;
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as SourceSnapshot;
    if (data.indexHash !== sourceHash(JSON.stringify({ ...data, indexHash: '' })) || data.schema !== 1 || data.extractor !== 'selection-original-v1' || data.version !== snapshotKey(data.originalHash, data.origin)
      || !insideSourceDirectory(data.textPath, directory) || !insideSourceDirectory(join(dirname(manifest), 'original'), directory)
      || sourceHash(readFileSync(data.textPath)) !== data.textHash || sourceHash(readFileSync(join(dirname(manifest), 'original'))) !== data.originalHash
      || !Array.isArray(data.units) || !Array.isArray(data.limitations)) return undefined;
    const lines = readFileSync(data.textPath, 'utf8').split('\n').length;
    if (data.units.some(unit => !unit.id || !Number.isInteger(unit.startLine) || !Number.isInteger(unit.endLine)
      || unit.startLine < 1 || unit.endLine < unit.startLine || unit.endLine > lines)) return undefined;
    if (!data.acquisition && (!insideSourceDirectory(data.originalPath, directory) || sourceHash(readFileSync(data.originalPath)) !== data.originalHash)) return undefined;
    return data;
  } catch { return undefined; }
}
