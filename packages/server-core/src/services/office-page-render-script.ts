/**
 * Script the capture host runs inside the rendered OfficeCLI HTML.
 * Kept as plain source text (not a compiled function) so bundlers cannot
 * inject helpers into it. Each call returns JSON-safe data.
 *
 * Ops:
 * - prepare  → hide viewer chrome, report page / slide count and sheet names
 * - measure  → size of one target in CSS px (before the window is resized)
 * - locate   → viewport rect of the same target after resizing and scrolling
 * - fonts    → requested font families this machine does not have
 */

export type OfficePageScriptRequest =
  | { op: 'prepare'; kind: 'docx' | 'xlsx' | 'pptx' }
  | { op: 'measure' | 'locate'; kind: 'docx' | 'xlsx' | 'pptx'; page?: number; sheet?: string; range?: string; maxCssEdge: number }
  | { op: 'fonts'; kind: 'docx' | 'xlsx' | 'pptx' }

const SOURCE = String.raw`(async function (req) {
  const css = {
    docx: 'html,body{background:#fff!important}::-webkit-scrollbar{display:none}',
    pptx: '.sidebar,.sidebar-toggle,.toggle-zone,.page-counter,.slide-label,.file-title{display:none!important}.main{margin:0!important;overflow:visible!important}html,body{overflow:visible!important;height:auto!important}::-webkit-scrollbar{display:none}',
    xlsx: '.sheet-tabs{display:none!important}html,body{height:auto!important;overflow:visible!important}body{display:block!important}.sheet-slider,.sheet-content.active,.table-wrapper{overflow:visible!important;height:auto!important;max-height:none!important;flex:none!important}th,thead th,.row-header,.col-header,.corner-cell{position:static!important}::-webkit-scrollbar{display:none}',
  };
  if (!document.getElementById('selection-office-render')) {
    const style = document.createElement('style');
    style.id = 'selection-office-render';
    style.textContent = css[req.kind] || '';
    document.head.appendChild(style);
  }
  const tabs = () => [...document.querySelectorAll('.sheet-tab')];
  const sheetNames = () => tabs().map(tab => (tab.textContent || '').trim());
  if (req.op === 'prepare') {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
    if (req.kind === 'docx') {
      // OfficeCLI only starts a new .page at explicit page / section breaks. Cut taller
      // pages at the nominal page height so each image is one sheet of paper.
      const slices = [];
      let cut = false;
      for (const page of document.querySelectorAll('.page[data-page]')) {
        const declared = /min-height\s*:\s*([0-9.]+)pt/.exec(page.getAttribute('style') || '');
        const nominal = declared ? parseFloat(declared[1]) * 4 / 3 : 1123;
        const height = page.getBoundingClientRect().height;
        const count = Math.max(1, Math.ceil((height - 2) / nominal));
        if (count > 1) cut = true;
        for (let i = 0; i < count; i++) slices.push({ page: page.getAttribute('data-page'), offset: i * nominal, height: Math.min(nominal, height - i * nominal) });
      }
      window.__selectionOfficeSlices = slices;
      return { pageCount: slices.length, approximatePages: cut };
    }
    if (req.kind === 'pptx') return { pageCount: document.querySelectorAll('.slide-container[data-slide]').length };
    const names = sheetNames();
    return { pageCount: names.length || document.querySelectorAll('.sheet-content').length, sheets: names };
  }
  // OfficeCLI 按每行 15pt 估算浮动图表的 top，表格行被中文字体和大字号撑高后，
  // 图表会往上盖住指标。按 data-from-row 对到实际行的位置（与协同面板同一算法）。
  const anchorFloats = (root) => {
    for (const el of root.querySelectorAll('[data-from-row]')) {
      const content = el.closest('.sheet-content');
      if (!content) continue;
      const row = parseInt(el.getAttribute('data-from-row') || '', 10) + 1;
      const tr = content.querySelector('tr[data-row="' + content.getAttribute('data-sheet') + '-' + row + '"]');
      const want = tr && tr.getBoundingClientRect();
      if (!want || !want.height) continue;
      const have = el.getBoundingClientRect();
      const delta = want.top - have.top;
      if (Math.abs(delta) > 0.5) el.style.top = ((parseFloat(getComputedStyle(el).top) || 0) + delta) + 'px';
      let n = parseInt(el.getAttribute('data-from-col') || '', 10) + 1, letters = '';
      while (n > 0) { letters = String.fromCharCode(65 + (n - 1) % 26) + letters; n = Math.floor((n - 1) / 26); }
      const cell = letters && [...tr.querySelectorAll('td[data-path]')].find(td => (td.getAttribute('data-path') || '').endsWith('/' + letters + row));
      const left = cell && cell.getBoundingClientRect();
      const dx = left && left.width ? left.left - have.left : 0;
      if (Math.abs(dx) > 0.5) el.style.left = ((parseFloat(getComputedStyle(el).left) || 0) + dx) + 'px';
    }
  };
  const colIndex = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const activeSheet = () => {
    const names = sheetNames();
    let index = req.sheet ? names.findIndex(name => name === req.sheet) : 0;
    if (index < 0 && req.sheet) index = names.findIndex(name => name.toLowerCase() === String(req.sheet).toLowerCase());
    if (index < 0) return null;
    if (names.length && typeof window.switchSheet === 'function') window.switchSheet(index);
    const content = document.querySelector('.sheet-content[data-sheet="' + index + '"]') || document.querySelector('.sheet-content');
    if (content) anchorFloats(content);
    return content ? { index, name: names[index] || String(req.sheet || ''), content } : null;
  };
  const target = () => {
    if (req.kind === 'docx') {
      const slice = (window.__selectionOfficeSlices || [])[req.page - 1];
      const el = slice && document.querySelector('.page[data-page="' + slice.page + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { rect: { left: r.left, top: r.top + slice.offset, width: r.width, height: slice.height }, el };
    }
    if (req.kind === 'pptx') {
      if (typeof window.scaleSlides === 'function') window.scaleSlides();
      const el = document.querySelector('.slide-container[data-slide="' + req.page + '"] .slide');
      return el ? { rect: el.getBoundingClientRect(), el } : null;
    }
    const sheet = activeSheet();
    if (!sheet) return null;
    const table = sheet.content.querySelector('table') || sheet.content;
    if (!req.range) return { rect: table.getBoundingClientRect(), el: table, sheet: sheet.name };
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(req.range);
    if (!match) return null;
    const c1 = Math.min(colIndex(match[1]), colIndex(match[3])), c2 = Math.max(colIndex(match[1]), colIndex(match[3]));
    const r1 = Math.min(+match[2], +match[4]), r2 = Math.max(+match[2], +match[4]);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const cell of sheet.content.querySelectorAll('td[data-path]')) {
      const address = /\/([A-Z]+)(\d+)$/.exec(cell.getAttribute('data-path') || '');
      if (!address) continue;
      const col = colIndex(address[1]), row = +address[2];
      if (col < c1 || col > c2 || row < r1 || row > r2) continue;
      const rect = cell.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      left = Math.min(left, rect.left); top = Math.min(top, rect.top);
      right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    }
    if (!Number.isFinite(left)) return null;
    return { rect: { left, top, width: right - left, height: bottom - top }, el: null, sheet: sheet.name };
  };
  if (req.op === 'measure' || req.op === 'locate') {
    const found = target();
    if (!found || !found.rect.width || !found.rect.height) return null;
    const width = Math.min(found.rect.width, req.maxCssEdge);
    const height = Math.min(found.rect.height, req.maxCssEdge);
    const truncated = found.rect.width > req.maxCssEdge || found.rect.height > req.maxCssEdge;
    if (req.op === 'measure') return { width, height, truncated, sheet: found.sheet };
    const absLeft = found.rect.left + window.scrollX, absTop = found.rect.top + window.scrollY;
    window.scrollTo(Math.max(0, absLeft - 4), Math.max(0, absTop - 4));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const again = target();
    const rect = again ? again.rect : found.rect;
    const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
    return {
      x, y,
      width: Math.max(1, Math.min(width, window.innerWidth - x)),
      height: Math.max(1, Math.min(height, window.innerHeight - y)),
      truncated,
      sheet: found.sheet,
    };
  }
  if (req.op === 'fonts') {
    const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|-apple-system|blinkmacsystemfont)$/i;
    const requested = new Set();
    const faces = new Map();
    if (document.fonts) for (const face of document.fonts) faces.set(face.family.replace(/^["']|["']$/g, ''), face);
    let scanned = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (++scanned > 20000) break;
      if (![...el.childNodes].some(node => node.nodeType === 3 && (node.textContent || '').trim())) continue;
      const first = (getComputedStyle(el).fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (first && !generic.test(first)) requested.add(first);
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sample = 'mmmmmmmmmmlli 永和中文排版 ABC 123';
    const width = (font) => { ctx.font = font; return ctx.measureText(sample).width; };
    const missing = [];
    for (const family of requested) {
      const face = faces.get(family);
      if (face) {
        try { await face.load(); } catch {}
        if (face.status === 'loaded') continue;
        if (face.status === 'error') { missing.push(family); continue; }
      }
      const quoted = '"' + family.replace(/"/g, '') + '"';
      const same = ['monospace', 'serif', 'sans-serif'].every(base => Math.abs(width('40px ' + quoted + ', ' + base) - width('40px ' + base)) < 0.01);
      if (same) missing.push(family);
    }
    return { missingFonts: missing.sort() };
  }
  return null;
})`

/** Expression that evaluates to a Promise of the op result inside the page. */
export function officePageScript(request: OfficePageScriptRequest): string {
  return `${SOURCE}(${JSON.stringify(request).replace(/</g, '\\u003c')})`
}
