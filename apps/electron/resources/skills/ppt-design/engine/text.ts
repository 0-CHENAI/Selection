import type { Bounds, TextCapacity } from './types';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff00-\uffef]/u;
const WIDE_LATIN = /[MW@%#Q]/;
const PUNCT_ONLY = /^[\s.,;:!?，。；：、！？…—\-·"'“”‘’（）()【】《》]+$/u;

export function charUnit(character: string): number {
  if (CJK.test(character)) return 1;
  if (WIDE_LATIN.test(character)) return 0.92;
  if (character === ' ') return 0.33;
  return 0.58;
}

export function measureUnits(text: string): number {
  let units = 0;
  for (const character of text) units += charUnit(character);
  return units;
}

export function lineCapacity(widthPt: number, fontSize: number): number {
  if (fontSize <= 0) return 0;
  return widthPt / fontSize;
}

export function wrapLines(text: string, widthPt: number, fontSize: number): string[] {
  const capacity = Math.max(0.5, lineCapacity(widthPt, fontSize));
  const rows: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph.length === 0) {
      rows.push('');
      continue;
    }
    let current = '';
    let used = 0;
    for (const character of paragraph) {
      const unit = charUnit(character);
      if (current && used + unit > capacity) {
        rows.push(current);
        current = character;
        used = unit;
      } else {
        current += character;
        used += unit;
      }
    }
    rows.push(current);
  }
  return rows;
}

export function neededLines(text: string, widthPt: number, fontSize: number): number {
  return wrapLines(text, widthPt, fontSize).length;
}

export function autoCapacity(text: string, bounds: Bounds, fontSize: number, lineHeight = 1.18): TextCapacity {
  const maxCharsPerLine = Math.max(1, Math.floor(lineCapacity(bounds[2], fontSize)));
  const wrapped = neededLines(text, bounds[2], fontSize);
  const byHeight = Math.max(1, Math.floor(bounds[3] / Math.max(1, fontSize * lineHeight)));
  return {
    maxLines: Math.max(wrapped, byHeight),
    maxCharsPerLine,
  };
}

export function hasLiteralNewline(text: string): boolean {
  return text.includes('\\n');
}

export function orphanLine(lines: string[]): string | undefined {
  if (lines.length < 2) return undefined;
  const last = lines[lines.length - 1] ?? '';
  const trimmed = last.trim();
  if (!trimmed) return last;
  if (PUNCT_ONLY.test(trimmed)) return trimmed;
  const units = measureUnits(trimmed);
  if (units <= 1.05) return trimmed;
  if (!CJK.test(trimmed) && trimmed.split(/\s+/).length === 1 && trimmed.length <= 2) return trimmed;
  return undefined;
}

export function capacityOverflow(
  text: string,
  bounds: Bounds,
  fontSize: number,
  capacity: TextCapacity,
  lineHeight = 1.18,
): string | undefined {
  const lines = wrapLines(text, bounds[2], fontSize);
  if (lines.length > capacity.maxLines) {
    return `${lines.length} lines > capacity ${capacity.maxLines}`;
  }
  const widest = Math.max(0, ...lines.map(measureUnits));
  if (widest > capacity.maxCharsPerLine + 0.35) {
    return `line uses ${widest.toFixed(2)} units > ${capacity.maxCharsPerLine}`;
  }
  const height = lines.length * fontSize * lineHeight;
  if (height > bounds[3] + 0.75) {
    return `needed ${height.toFixed(1)}pt > box ${bounds[3]}pt`;
  }
  return undefined;
}
