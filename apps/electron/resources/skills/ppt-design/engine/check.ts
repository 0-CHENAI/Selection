import { existsSync, statSync } from 'node:fs';
import { backgroundBehind, contrastRatio, requiredContrast } from './contrast';
import { intersects, outOfCanvas } from './geometry';
import { parseDeck } from './schema';
import { capacityOverflow, hasLiteralNewline, orphanLine, wrapLines } from './text';
import { resolveColor, resolveSize } from './tokens';
import type { CheckReport, Deck, DeckElement, DeckIssue, Page } from './types';

function issue(code: DeckIssue['code'], pageId: string, message: string, elementId?: string): DeckIssue {
  return { code, pageId, elementId, message };
}

function isContent(element: DeckElement): boolean {
  return element.type === 'text' || element.type === 'chart' || element.type === 'image';
}

function checkPage(deck: Deck, page: Page): DeckIssue[] {
  const found: DeckIssue[] = [];
  const background = resolveColor(deck.theme, page.background ?? 'background');
  page.elements.forEach((element, index) => {
    const overflow = outOfCanvas(element.bounds);
    if (overflow) found.push(issue('out_of_bounds', page.id, overflow, element.id));
    for (let other = index + 1; other < page.elements.length; other++) {
      const peer = page.elements[other];
      if (isContent(element) && isContent(peer) && intersects(element.bounds, peer.bounds)) {
        found.push(issue('overlap', page.id, `overlaps ${peer.id}`, element.id));
      }
    }
    if (element.type === 'image' && (!existsSync(element.path) || !statSync(element.path).isFile())) {
      found.push(issue('missing_image', page.id, `image missing: ${element.path}`, element.id));
    }
    if (element.type !== 'text') return;
    if (hasLiteralNewline(element.text)) {
      found.push(issue('literal_newline', page.id, 'contains literal \\n instead of a real line break', element.id));
    }
    const size = resolveSize(deck.theme, element.style);
    const lineHeight = element.style?.lineHeight ?? 1.18;
    const overflowText = capacityOverflow(element.text, element.bounds, size, element.textCapacity, lineHeight);
    if (overflowText) found.push(issue('over_capacity', page.id, overflowText, element.id));
    const lines = wrapLines(element.text, element.bounds[2], size);
    const orphan = orphanLine(lines);
    if (orphan) found.push(issue('orphan', page.id, `orphan last line “${orphan}”`, element.id));
    try {
      const foreground = resolveColor(deck.theme, element.style?.color ?? 'text');
      const behind = resolveColor(deck.theme, backgroundBehind(page, element, background));
      const ratio = contrastRatio(foreground, behind);
      const need = requiredContrast(size, element.style?.weight ?? 400);
      if (ratio + 0.02 < need) {
        found.push(issue('contrast', page.id, `contrast ${ratio.toFixed(2)}:1 < ${need}:1 on ${behind}`, element.id));
      }
    } catch (error) {
      found.push(issue('contrast', page.id, error instanceof Error ? error.message : String(error), element.id));
    }
  });
  return found;
}

export function checkDeck(value: unknown): CheckReport {
  const { deck, issues } = parseDeck(value);
  const collected: DeckIssue[] = issues.map(item => issue('schema', item.path, item.message));
  if (!deck) return { ok: false, issues: collected };
  deck.pages.forEach((page, index) => {
    if (index > 0 && deck.pages[index - 1].layout === page.layout) {
      collected.push(issue('adjacent_layout', page.id, `adjacent repeated layout ${page.layout}`));
    }
    collected.push(...checkPage(deck, page));
  });
  return { ok: collected.length === 0, issues: collected };
}

export function assertCheck(deck: Deck): Deck {
  const report = checkDeck(deck);
  if (!report.ok) {
    throw new Error(report.issues.map(item => `${item.pageId}${item.elementId ? '/' + item.elementId : ''}: ${item.code} ${item.message}`).join('\n'));
  }
  return deck;
}
