import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parse, type HTMLElement } from 'node-html-parser';
import { insideSourceDirectory, readSourceSnapshot, saveSourceSnapshot, sourceIndexPath, sourceHash, type SourceSnapshot, type SourceUnit } from '@craft-agent/shared/source-snapshot';
import { lock } from 'proper-lockfile';
import { extractPdfPages, readPdfPages } from './web-fetch.ts';

type Part = { id: string; label: string; kind: SourceUnit['kind']; text: string };
const MAX_DOCX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_DOCX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_DOCX_UNITS = 50_000;
const docxIndexes = new Map<string, { version: string; snapshot: SourceSnapshot; manifest: string; snapshotVersion: string }>();

const fileStamp = async (path: string) => {
  const info = await stat(path, { bigint: true });
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
};
const snapshotStamp = (manifest: string, snapshot: SourceSnapshot) =>
  Promise.all([manifest, snapshot.textPath, join(dirname(manifest), 'original')].map(fileStamp)).then(values => values.join('|'));
const elements = (node: HTMLElement, tag: string): HTMLElement[] => {
  const result: HTMLElement[] = [];
  const visit = (n: HTMLElement) => { if (n.rawTagName === tag) result.push(n); for (const child of n.childNodes) if ('rawTagName' in child) visit(child as HTMLElement); };
  visit(node); return result;
};
const xml = (bytes: Uint8Array | undefined) => parse(bytes ? strFromU8(bytes) : '', { lowerCaseTagName: false });
const text = (node: HTMLElement, tag: string) => elements(node, tag).map(n => n.textContent).join('');

// Workers have separate processes. Share the extraction by byte content within the authorized
// directory, then bind each original path to its own immutable source and read receipts.
async function indexResearchPdf(directory: string, path: string, bytes: Buffer) {
  const hash = sourceHash(bytes);
  const store = join(directory, '.selection-sources');
  mkdirSync(store, { recursive: true });
  if (!insideSourceDirectory(store, directory)) throw new Error('Source store leaves the authorized directory');
  const aliases = join(store, `pdf-v2-${hash}`);
  mkdirSync(aliases, { recursive: true });
  if (!insideSourceDirectory(aliases, store)) throw new Error('PDF cache leaves the source store');
  const release = await lock(aliases, { stale: 120_000, retries: { retries: 180, minTimeout: 100, maxTimeout: 1000 } });
  try {
    let parts: Part[] | undefined;
    let limitations: string[] = [];
    for (const version of readdirSync(aliases)) {
      const cached = readSourceSnapshot(join(store, version, 'index.json'), directory);
      if (cached?.extractor !== 'selection-pdf-v2' || cached.version !== version || cached.originalHash !== hash) continue;
      if (cached.originalPath === path) return cached;
      const lines = readFileSync(cached.textPath, 'utf8').split('\n');
      parts = cached.units.map(unit => ({ ...unit, text: lines.slice(unit.startLine - 1, unit.endLine).join('\n') }));
      limitations = cached.limitations;
      break;
    }
    if (!parts) {
      const pages = await readPdfPages(bytes, true);
      parts = pages.map(({ text, pageLabel, printedPage, headings }, i) => ({
        id: `page-${i + 1}`, kind: 'page', text,
        label: [`第 ${i + 1} 页`, pageLabel && `PDF 页标 ${pageLabel}`, printedPage !== undefined && `印刷页 ${printedPage}（页眉页脚推断）`, ...headings].filter(Boolean).join(' · '),
      }));
      if (!parts.some(part => part.text.trim())) throw new Error('No extractable original text; use the native PDF/OCR skill.');
      limitations = [pages.some(page => page.headings.length) ? 'Headings come from PDF bookmarks.' : 'No locatable PDF bookmarks; indexed by file page.',
        'PDF text layer; page labels come from the file when available. Check scans and visual layout with the PDF skill.'];
      for (const part of parts) if (!part.text.trim()) limitations.push(`${part.label}: no extractable text.`);
    }
    const snapshot = saveSourceSnapshot(directory, bytes, path, '.pdf', parts, limitations, undefined, path, 'selection-pdf-v2');
    mkdirSync(join(aliases, snapshot.version), { recursive: true });
    return snapshot;
  } finally {
    await release();
  }
}

/** Uses literal native structure; never asks a model to invent pages or headings. */
export async function indexOriginalDocument(directory: string, file: string, research = false): Promise<SourceSnapshot> {
  const path = realpathSync(resolve(directory, file));
  if (!insideSourceDirectory(path, directory)) throw new Error('Document leaves the authorized directory');
  const format = extname(path).toLowerCase();
  const researchPdf = research && format === '.pdf';
  const docxKey = `${directory}\0${path}`;
  let docxBytes: Buffer | undefined;
  let docxVersion: string | undefined;
  if (format === '.docx') {
    if ((await stat(path)).size > MAX_DOCX_SOURCE_BYTES) throw new Error('DOCX sources larger than 128 MiB must be split before indexing.');
    docxVersion = await fileStamp(path);
    const cached = docxIndexes.get(docxKey);
    if (cached?.version === docxVersion
      && await snapshotStamp(cached.manifest, cached.snapshot).catch(() => undefined) === cached.snapshotVersion
      && insideSourceDirectory(cached.snapshot.textPath, directory)) {
      if (docxIndexes.get(docxKey) === cached) {
        docxIndexes.delete(docxKey);
        docxIndexes.set(docxKey, cached);
      }
      return cached.snapshot;
    }
    if (docxIndexes.get(docxKey) === cached) docxIndexes.delete(docxKey);
    docxBytes = await readFile(path);
    if (docxBytes.length > MAX_DOCX_SOURCE_BYTES || await fileStamp(path) !== docxVersion) {
      throw new Error('The DOCX changed during indexing. Retry after it is saved.');
    }
  }
  const manifest = sourceIndexPath(directory, path, researchPdf ? 'selection-pdf-v2' : 'selection-original-v1', docxBytes);
  const rememberDocx = async (snapshot: SourceSnapshot) => {
    if (docxVersion !== undefined) {
      if (await fileStamp(path) !== docxVersion) throw new Error('The DOCX changed during indexing. Retry after it is saved.');
      docxIndexes.set(docxKey, { version: docxVersion, snapshot, manifest, snapshotVersion: await snapshotStamp(manifest, snapshot) });
      let cachedUnits = [...docxIndexes.values()].reduce((sum, entry) => sum + entry.snapshot.units.length, 0);
      for (const [oldest, entry] of docxIndexes) {
        if (docxIndexes.size <= 8 && cachedUnits <= MAX_CACHED_DOCX_UNITS) break;
        docxIndexes.delete(oldest);
        cachedUnits -= entry.snapshot.units.length;
      }
    }
    return snapshot;
  };
  const existing = readSourceSnapshot(manifest, directory);
  if (existing) return rememberDocx(existing);
  const bytes = docxBytes ?? readFileSync(path);
  if (researchPdf) return indexResearchPdf(directory, path, bytes);
  let parts: Part[] = [];
  const limitations: string[] = [];
  if (format === '.pdf') {
    const pages = await extractPdfPages(bytes);
    parts = pages.map((text, i) => ({ id: `page-${i + 1}`, label: `第 ${i + 1} 页`, kind: 'page', text }));
    limitations.push('PDF text layer only; reading order, figures and visual layout require separate visual review. OCR is not implied.');
    pages.forEach((page, i) => { if (!page.trim()) limitations.push(`Page ${i + 1} has no extractable text; use native PDF/OCR skill.`); });
  } else if (['.docx', '.xlsx', '.pptx'].includes(format)) {
    const archive = format === '.docx' ? unzipSync(bytes, { filter: entry => {
      if (entry.name !== 'word/document.xml') return false;
      if (entry.originalSize > MAX_DOCX_BODY_BYTES) throw new Error('The DOCX body XML exceeds 64 MiB. Split the document before indexing.');
      return true;
    } }) : unzipSync(bytes);
    limitations.push('Office structure/text extraction only; rendered layout, charts, formulas and formatting require the native Office Skill.');
    if (format === '.docx') {
      if (!archive['word/document.xml']) throw new Error('The DOCX is missing its main document body.');
      const doc = xml(archive['word/document.xml']); let chapter = '正文';
      parts = elements(doc, 'w:p').flatMap((p, i) => {
        const value = text(p, 'w:t'); if (!value.trim()) return [];
        const style = elements(p, 'w:pStyle')[0]?.getAttribute('w:val');
        if (style && /^(Heading\d|Title|标题)/i.test(style)) chapter = value;
        return [{ id: `paragraph-${i + 1}`, label: `${chapter} · 段落 ${i + 1}`, kind: 'paragraph' as const, text: value }];
      });
      limitations.push('DOCX paragraphs/heading styles are stable locations; physical page numbers are unavailable until rendered. Headers, footnotes and tracked changes are not covered.');
    } else if (format === '.xlsx') {
      const shared = elements(xml(archive['xl/sharedStrings.xml']), 'si').map(si => text(si, 't'));
      const rels = new Map(elements(xml(archive['xl/_rels/workbook.xml.rels']), 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
      for (const sheet of elements(xml(archive['xl/workbook.xml']), 'sheet')) {
        const name = sheet.getAttribute('name') ?? 'Sheet';
        const target = rels.get(sheet.getAttribute('r:id')); if (!target) continue;
        const key = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        if (!archive[key]) { limitations.push(`Worksheet ${name} is unavailable.`); continue; }
        for (const cell of elements(xml(archive[key]), 'c')) {
          const address = cell.getAttribute('r'); if (!address) continue;
          const raw = text(cell, 'v');
          const value = cell.getAttribute('t') === 's' ? shared[Number(raw)] ?? '' : cell.getAttribute('t') === 'inlineStr' ? text(cell, 't') : raw;
          const formula = text(cell, 'f');
          if (!value && !formula) continue;
          parts.push({ id: `${name}!${address}`, label: `${name}!${address}`, kind: 'cell', text: value });
          if (formula) limitations.push(`${name}!${address}: cached value; formula is not recalculated.`);
        }
      }
    } else {
      const rels = new Map(elements(xml(archive['ppt/_rels/presentation.xml.rels']), 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
      elements(xml(archive['ppt/presentation.xml']), 'p:sldId').forEach((slide, i) => {
        const target = rels.get(slide.getAttribute('r:id')); if (!target) return;
        const key = target.startsWith('/') ? target.slice(1) : `ppt/${target}`;
        parts.push({ id: `slide-${i + 1}`, label: `幻灯片 ${i + 1}`, kind: 'slide', text: elements(xml(archive[key]), 'a:p').map(p => text(p, 'a:t')).join('\n') });
      });
    }
  } else {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.includes(0)) throw new Error('Unsupported binary format; use the native document Skill. No index/read receipt was created.');
    const lines = source.split('\n'); let start = 0, label = '正文';
    const push = (end: number) => { if (end > start) parts.push({ id: `section-${start + 1}`, label, kind: 'section', text: lines.slice(start, end).join('\n') }); };
    lines.forEach((line, i) => { if (/^#{1,6}\s+\S/.test(line)) { push(i); start = i; label = line.replace(/^#+\s*/, ''); } }); push(lines.length);
    limitations.push('Text sections use literal Markdown headings and line ranges, not physical pages.');
  }
  if (!parts.some(part => part.text.trim())) throw new Error('No extractable original text; use native parsing/OCR. No read receipt was created.');
  return rememberDocx(saveSourceSnapshot(directory, bytes, path, format, parts, limitations, undefined, path));
}
const indexSchema = Type.Object({ path: Type.String(), query: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })) });
const readSchema = Type.Object({ path: Type.String(), unit_id: Type.String({ description: 'Exact unit ID from document_index (chapter/paragraph, page or worksheet!cell).' }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1 })), quote: Type.Optional(Type.String({ minLength: 1, pattern: '\\S', description: 'Optional exact literal quotation to check inside the returned original range.' })) });
export function createDocumentTools(getDirectory: () => string, getSourceDirectory?: () => string | undefined, research = false): ToolDefinition<any, any>[] {
  const indexDocument = (file: string) => {
    const directory = getDirectory(), path = realpathSync(resolve(directory, file));
    const sourceDirectory = getSourceDirectory?.();
    const readDirectory = !insideSourceDirectory(path, directory) && sourceDirectory && insideSourceDirectory(path, sourceDirectory)
      ? sourceDirectory : directory;
    return indexOriginalDocument(readDirectory, path, research);
  };
  return [{ name: 'document_index', label: '定位文档', description: 'Index native original structure by file version, search headings/pages/cells, then use document_read for original text. Index results are navigation, not proof of reading or semantic verification. Existing Office/PDF Skills remain available for full editing, OCR and visual QA.', parameters: indexSchema,
    async execute(_id, rawParams, signal) { const params = rawParams as Static<typeof indexSchema>; signal?.throwIfAborted(); const snapshot = await indexDocument(params.path);
      const textLines = readFileSync(snapshot.textPath, 'utf8').split('\n');
      const query = params.query?.toLowerCase();
      const matches = snapshot.units.filter(unit => !query || unit.label.toLowerCase().includes(query) || textLines.slice(unit.startLine - 1, unit.endLine).join('\n').toLowerCase().includes(query));
      const offset = params.offset ?? 0;
      return { content: [{ type: 'text', text: JSON.stringify({ path: snapshot.originalPath, sourceVersion: snapshot.version, snapshotPath: snapshot.textPath,
        total: matches.length, units: matches.slice(offset, offset + 100), next_offset: offset + 100 < matches.length ? offset + 100 : null, limitations: snapshot.limitations, readEvidence: false }) }], details: {} };
    } }, { name: 'document_read', label: '读取文档原文', description: 'Read a located unit from the current original version. Returns original lines, physical page/cell/paragraph location, limits and an exact read receipt. Quote check is literal only; semantic support and visual layout need independent review.', parameters: readSchema,
    async execute(_id, rawParams, signal) {
      const params = rawParams as Static<typeof readSchema>;
      signal?.throwIfAborted();
      if (params.quote !== undefined && !params.quote.trim()) throw new Error('Provide a nonempty literal quotation or omit quote.');
      const snapshot = await indexDocument(params.path);
      const unit = snapshot.units.find(unit => unit.id === params.unit_id); if (!unit) throw new Error('Unit not found in the current file version; refresh document_index.');
      const startLine = unit.startLine + (params.offset ?? 0); if (startLine > unit.endLine) throw new Error('Offset leaves the original unit.');
      const allLines = readFileSync(snapshot.textPath, 'utf8').split('\n');
      const lines = allLines.slice(startLine - 1, Math.min(unit.endLine, startLine + (params.limit ?? unit.endLine) - 1));
      // Same bounded native text delivery policy as Read. Never claim a partial line as a full returned range.
      let returned = ''; let count = 0;
      for (const line of lines) { const next = count ? `${returned}\n${line}` : line; if (next.length > 50_000) break; returned = next; count++; }
      if ((!count || !returned.trim()) && !(research && snapshot.format === '.pdf' && params.quote?.trim())) throw new Error('No complete readable line returned; use the native document Skill.');
      const endLine = startLine + count - 1;
      // Hits elsewhere are navigation only. The receipt still covers exactly the returned text.
      const quote = params.quote;
      const quoteLocations = research && snapshot.format === '.pdf' && quote?.trim() && !returned.includes(quote)
        ? snapshot.units.filter(page => allLines.slice(page.startLine - 1, page.endLine).join('\n').includes(quote))
          .map(({ id, label }) => ({ id, label })) : undefined;
      const note = { ...(quoteLocations && { quoteLocations }), location: unit.label, sourceVersion: snapshot.version, startLine, endLine, snapshotPath: snapshot.textPath, limitations: snapshot.limitations,
        ...(params.quote !== undefined ? { quoteMatched: returned.includes(params.quote) } : {}), more: endLine < unit.endLine };
      if (!returned.trim()) return { content: [{ type: 'text', text: JSON.stringify({ location: unit.label, quoteMatched: false, quoteLocations, readEvidence: false }) }], details: {} };
      return { content: [{ type: 'text', text: `${returned}\n\n${JSON.stringify(note)}` }], details: { sourceRead: { path: snapshot.textPath,
        contentHash: snapshot.textHash, startLine, endLine, returnedTextHash: sourceHash(returned) } } };
    } }];
}
