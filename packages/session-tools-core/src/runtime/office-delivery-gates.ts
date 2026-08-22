import { officeQueryMatchCount, outlineHeadingSourceCount } from './office-docx-fields.ts';

export { officeQueryMatchCount };

export const PLACEHOLDER_LEAK_PATTERN = /\$[A-Za-z_][A-Za-z0-9_]*\$|\{\{[^{}]+\}\}|\{[A-Za-z_][A-Za-z0-9_]*\}|<TODO>|xxxx|lorem|ipsum|placeholder|this slide layout|\\[\$tn]/i;

export const EXCEL_ERROR_SELECTORS = [
  'cell:contains("#REF!")',
  'cell:contains("#DIV/0!")',
  'cell:contains("#VALUE!")',
  'cell:contains("#NAME?")',
  'cell:contains("#N/A")',
] as const;

export const WORD_HEADING1_MIN_PT = 18;
export const WORD_LIKELY_MULTIPAGE_PARAGRAPHS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function officeTextHaystack(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  return JSON.stringify(data);
}

export function placeholderLeakCount(data: unknown): number {
  const haystack = officeTextHaystack(data);
  return haystack.match(new RegExp(PLACEHOLDER_LEAK_PATTERN.source, 'gi'))?.length ?? 0;
}

export function outlineParagraphCount(data: unknown): number {
  if (!isRecord(data)) return 0;
  const paragraphs = data.paragraphs;
  return typeof paragraphs === 'number' && Number.isFinite(paragraphs) ? Math.max(0, paragraphs) : 0;
}

export function outlineSlideCount(data: unknown): number {
  if (!isRecord(data)) return 0;
  if (typeof data.totalSlides === 'number' && Number.isFinite(data.totalSlides)) {
    return Math.max(0, data.totalSlides);
  }
  return Array.isArray(data.slides) ? data.slides.length : 0;
}

export function outlinePageCount(data: unknown): number {
  if (!isRecord(data)) return 0;
  for (const key of ['pages', 'pageCount', 'totalPages'] as const) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

export function isSkillFalsePositiveIssue(extension: string, issue: Record<string, unknown>): boolean {
  const message = `${typeof issue.message === 'string' ? issue.message : ''} ${typeof issue.path === 'string' ? issue.path : ''}`;
  if (extension === '.docx' && /first-line indent/i.test(message)) return true;
  return false;
}

export function skillHeadingGateRequired(extension: string, outline: unknown): boolean {
  if (extension !== '.docx') return false;
  return outlineParagraphCount(outline) >= 4 || outlineHeadingSourceCount(outline) >= 3;
}

export function skillTocRequired(outline: unknown): boolean {
  return outlineHeadingSourceCount(outline) >= 3;
}

export function skillPageRequired(outline: unknown): boolean {
  return skillTocRequired(outline)
    || outlinePageCount(outline) > 1
    || outlineParagraphCount(outline) >= WORD_LIKELY_MULTIPAGE_PARAGRAPHS;
}

export function skillTocAndPageRequired(outline: unknown): boolean {
  return skillTocRequired(outline);
}

export function headingSizePt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(?:pt)?$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

function headingStyleName(record: Record<string, unknown>): string {
  const format = isRecord(record.format) ? record.format : undefined;
  const style = typeof record.style === 'string'
    ? record.style
    : typeof format?.style === 'string'
      ? format.style
      : '';
  return style;
}

function headingRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.flatMap(item => headingRecords(item));
  }
  if (!isRecord(data)) return [];
  const collected: Record<string, unknown>[] = [];
  if (Array.isArray(data.headings)) collected.push(...data.headings.filter(isRecord));
  if (Array.isArray(data.results)) collected.push(...data.results.filter(isRecord));
  if (/^Heading1$/i.test(headingStyleName(data))) collected.push(data);
  return collected;
}

function recordSizePt(record: Record<string, unknown>): number | undefined {
  const format = isRecord(record.format) ? record.format : undefined;
  const props = isRecord(record.props) ? record.props : undefined;
  const direct = headingSizePt(record.size)
    ?? headingSizePt(record.fontSize)
    ?? headingSizePt(record.sz)
    ?? (format ? headingSizePt(format.size) ?? headingSizePt(format.fontSize) : undefined)
    ?? (props ? headingSizePt(props.size) ?? headingSizePt(props.fontSize) : undefined);
  if (direct !== undefined) return direct;
  if (!Array.isArray(record.children)) return undefined;
  for (const child of record.children) {
    if (!isRecord(child)) continue;
    const nested = recordSizePt(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function heading1SizeSamples(data: unknown): number[] {
  return headingRecords(data)
    .filter(record => /^Heading1$/i.test(headingStyleName(record)))
    .map(recordSizePt)
    .filter((size): size is number => size !== undefined);
}

export function hasHeadingSizeEvidence(data: unknown): boolean {
  return heading1SizeSamples(data).length > 0;
}

export function undersizedHeading1Count(data: unknown, minPt = WORD_HEADING1_MIN_PT): number {
  return heading1SizeSamples(data).filter(size => size < minPt).length;
}
