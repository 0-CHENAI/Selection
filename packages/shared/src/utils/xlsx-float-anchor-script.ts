/**
 * In-page script that lays Excel floating charts over the cells they cover in Excel.
 *
 * OfficeCLI's Excel HTML estimates chart positions at 15pt per row, while CJK text
 * and custom heights make the real rows taller. The server (`xlsx-float-anchors.ts`)
 * writes each chart's Excel cell range as `data-anchor-range="fromX fromY toX toY"`
 * (0-based fractional cell coordinates). This script moves and sizes the chart to
 * the rendered position of those cells, so it covers the same cells as in Excel.
 * Charts without a range keep their size and only snap to the anchor cell.
 *
 * Shared verbatim by the preview panel and the office_render capture host. Plain
 * ES2017 source text, no imports, safe to embed in another script.
 */
export const XLSX_FLOAT_ANCHOR_SOURCE = String.raw`function anchorXlsxFloats(root) {
  if (!root || !root.querySelectorAll) return;
  const contents = root.matches && root.matches('.sheet-content') ? [root] : [...root.querySelectorAll('.sheet-content')];
  const letters = (index) => { let n = index + 1, out = ''; while (n > 0) { out = String.fromCharCode(65 + (n - 1) % 26) + out; n = Math.floor((n - 1) / 26); } return out; };
  for (const content of contents) {
    const floats = [...content.querySelectorAll('[data-from-row]')];
    if (!floats.length) continue;
    const sheet = content.getAttribute('data-sheet');
    const cols = new Map();
    for (const th of content.querySelectorAll('th.col-header[data-path]')) {
      const match = /\/col\[([A-Z]+)\]$/.exec(th.getAttribute('data-path') || '');
      if (match) cols.set(match[1], th.getBoundingClientRect());
    }
    const rowRect = (index) => { const tr = content.querySelector('tr[data-row="' + sheet + '-' + (index + 1) + '"]'); return tr ? tr.getBoundingClientRect() : null; };
    const cellRect = (col, row) => {
      const tr = content.querySelector('tr[data-row="' + sheet + '-' + (row + 1) + '"]');
      const name = letters(col) + (row + 1);
      const td = tr && [...tr.querySelectorAll('td[data-path]')].find(cell => (cell.getAttribute('data-path') || '').endsWith('/' + name));
      return td ? td.getBoundingClientRect() : null;
    };
    const xAt = (x, row) => {
      const index = Math.floor(x);
      const rect = cols.get(letters(index)) || (row >= 0 ? cellRect(index, row) : null);
      return rect && (rect.width || rect.height) ? rect.left + (x - index) * rect.width : null;
    };
    const yAt = (y) => {
      const index = Math.floor(y);
      const rect = rowRect(index);
      return rect && (rect.width || rect.height) ? rect.top + (y - index) * rect.height : null;
    };
    for (const el of floats) {
      const range = (el.getAttribute('data-anchor-range') || '').split(' ').map(Number);
      const ranged = range.length === 4 && range.every(Number.isFinite);
      const fromX = ranged ? range[0] : parseInt(el.getAttribute('data-from-col') || '', 10);
      const fromY = ranged ? range[1] : parseInt(el.getAttribute('data-from-row') || '', 10);
      if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) continue;
      const top = yAt(fromY), left = xAt(fromX, Math.floor(fromY));
      if (top === null) continue;
      if (ranged) {
        const bottom = yAt(range[3]), right = xAt(range[2], Math.floor(fromY));
        if (left !== null && right !== null && right - left > 1) el.style.width = (right - left) + 'px';
        if (bottom !== null && bottom - top > 1) el.style.height = (bottom - top) + 'px';
      }
      const have = el.getBoundingClientRect();
      const dy = top - have.top;
      if (Math.abs(dy) > 0.5) el.style.top = ((parseFloat(getComputedStyle(el).top) || 0) + dy) + 'px';
      const dx = left === null ? 0 : left - have.left;
      if (Math.abs(dx) > 0.5) el.style.left = ((parseFloat(getComputedStyle(el).left) || 0) + dx) + 'px';
    }
  }
}`
