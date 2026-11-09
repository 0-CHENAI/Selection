import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { readFileSync, realpathSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parse, type HTMLElement } from 'node-html-parser';
import { insideSourceDirectory, readSourceSnapshot, saveSourceSnapshot, sourceIndexPath, sourceHash, type SourceSnapshot, type SourceUnit } from '@craft-agent/shared/source-snapshot';
import { extractPdfPages } from './web-fetch.ts';

type Part = { id: string; label: string; kind: SourceUnit['kind']; text: string };
const elements = (node: HTMLElement, tag: string): HTMLElement[] => {
  const result: HTMLElement[] = [];
  const visit = (n: HTMLElement) => { if (n.rawTagName === tag) result.push(n); for (const child of n.childNodes) if ('rawTagName' in child) visit(child as HTMLElement); };
  visit(node); return result;
};
const xml = (bytes: Uint8Array | undefined) => parse(bytes ? strFromU8(bytes) : '', { lowerCaseTagName: false });
const text = (node: HTMLElement, tag: string) => elements(node, tag).map(n => n.textContent).join('');

/** Uses literal native structure; never asks a model to invent pages or headings. */
export async function indexOriginalDocument(directory: string, file: string): Promise<SourceSnapshot> {
  const path = realpathSync(resolve(directory, file));
  if (!insideSourceDirectory(path, directory)) throw new Error('Document leaves the authorized directory');
  const existing = readSourceSnapshot(sourceIndexPath(directory, path), directory);
  if (existing) return existing;
  const bytes = readFileSync(path), format = extname(path).toLowerCase();
  let parts: Part[] = [];
  const limitations: string[] = [];
  if (format === '.pdf') {
    const pages = await extractPdfPages(bytes);
    parts = pages.map((text, i) => ({ id: `page-${i + 1}`, label: `第 ${i + 1} 页`, kind: 'page', text }));
    limitations.push('PDF text layer only; reading order, figures and visual layout require separate visual review. OCR is not implied.');
    pages.forEach((page, i) => { if (!page.trim()) limitations.push(`Page ${i + 1} has no extractable text; use native PDF/OCR skill.`); });
  } else if (['.docx', '.xlsx', '.pptx'].includes(format)) {
    const archive = unzipSync(bytes);
    limitations.push('Office structure/text extraction only; rendered layout, charts, formulas and formatting require the native Office Skill.');
    if (format === '.docx') {
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
  return saveSourceSnapshot(directory, bytes, path, format, parts, limitations, undefined, path);
}
const indexSchema = Type.Object({ path: Type.String(), query: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })) });
const readSchema = Type.Object({ path: Type.String(), unit_id: Type.String({ description: 'Exact unit ID from document_index (chapter/paragraph, page or worksheet!cell).' }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1 })), quote: Type.Optional(Type.String({ description: 'Optional exact literal quotation to check inside the returned original range.' })) });
export function createDocumentTools(getDirectory: () => string, getSourceDirectory?: () => string | undefined): ToolDefinition<any, any>[] {
  const indexDocument = (file: string) => {
    const directory = getDirectory(), path = realpathSync(resolve(directory, file));
    const sourceDirectory = getSourceDirectory?.();
    const readDirectory = !insideSourceDirectory(path, directory) && sourceDirectory && insideSourceDirectory(path, sourceDirectory)
      ? sourceDirectory : directory;
    return indexOriginalDocument(readDirectory, path);
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
    async execute(_id, rawParams, signal) { const params = rawParams as Static<typeof readSchema>; signal?.throwIfAborted(); const snapshot = await indexDocument(params.path);
      const unit = snapshot.units.find(unit => unit.id === params.unit_id); if (!unit) throw new Error('Unit not found in the current file version; refresh document_index.');
      const startLine = unit.startLine + (params.offset ?? 0); if (startLine > unit.endLine) throw new Error('Offset leaves the original unit.');
      const lines = readFileSync(snapshot.textPath, 'utf8').split('\n').slice(startLine - 1, Math.min(unit.endLine, startLine + (params.limit ?? unit.endLine) - 1));
      // Same bounded native text delivery policy as Read. Never claim a partial line as a full returned range.
      let returned = ''; let count = 0;
      for (const line of lines) { const next = count ? `${returned}\n${line}` : line; if (next.length > 50_000) break; returned = next; count++; }
      if (!count || !returned.trim()) throw new Error('No complete readable line returned; use the native document Skill.');
      const endLine = startLine + count - 1;
      const note = { location: unit.label, sourceVersion: snapshot.version, startLine, endLine, snapshotPath: snapshot.textPath, limitations: snapshot.limitations,
        ...(params.quote !== undefined ? { quoteMatched: returned.includes(params.quote) } : {}), more: endLine < unit.endLine };
      return { content: [{ type: 'text', text: `${returned}\n\n${JSON.stringify(note)}` }], details: { sourceRead: { path: snapshot.textPath,
        contentHash: snapshot.textHash, startLine, endLine, returnedTextHash: sourceHash(returned) } } };
    } }];
}
