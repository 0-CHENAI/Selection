import katexSource from 'katex/dist/katex.min.js?raw'
import { officePreviewPageBridge } from './office-preview-page'

/** The sandbox has no application origin, network, file access, or write API. */
export function officePreviewDocument(html: string, previewId: string, options: { scrollY?: number; scrollX?: number; readOnly?: boolean; anchor?: { path: string; offset: number }; restorePaths?: string[]; page?: number } = {}): string {
  // OfficeCLI's CDN script onerror fallback overwrites formulas even when local KaTeX exists.
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  const id = JSON.stringify(previewId).replace(/</g, '\\u003c')
  const restorePaths = JSON.stringify(options.restorePaths ?? []).replace(/</g, '\\u003c')
  // Native MathML avoids CDN requests and external font dependencies inside the sandbox.
  const math = `<script>${katexSource.replace(/<\/script/gi, '<\\/script')}</script><script>const renderMath = katex.render; katex.render = (formula, element, options) => renderMath(formula, element, {...options, output:'mathml'});document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('.katex-formula').forEach(el => { katex.render(el.dataset.formula, el, {throwOnError:false, displayMode:!!el.dataset.display}); el.classList.add('katex-rendered'); }));</script>`
  const bridge = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
body, body * { -webkit-user-select: none !important; user-select: none !important; }
input, textarea, [contenteditable="true"], [contenteditable="true"] * {
  -webkit-user-select: text !important; user-select: text !important;
}
</style>
<script>
(() => {
  const previewId = ${id};
  const readOnly = ${!!options.readOnly};
  const anchor = ${JSON.stringify(options.anchor ?? null).replace(/</g, '\\u003c')};
  const restorePaths = ${restorePaths};
  let restored = false;
  ${officePreviewPageBridge(Number.isInteger(options.page) && options.page! >= 1 && options.page! <= 500 ? options.page! : null)}
  document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => {
    const element = anchor && [...document.querySelectorAll('[data-path]')].find(el => el.getAttribute('data-path') === anchor.path);
    window.scrollTo(${Number.isFinite(options.scrollX) ? options.scrollX : 0}, element ? window.scrollY + element.getBoundingClientRect().top - anchor.offset : ${Number.isFinite(options.scrollY) ? options.scrollY : 0});
    if (queuedPage) revealPage(queuedPage);
    restored = true;
    // The sandbox hides contentDocument from the parent. Paint the selection
    // here, after OfficeCLI has registered its click handlers.
    if (!readOnly && restorePaths.length) {
      const targets = restorePaths.map(path => { try { return document.querySelector('[data-path="' + CSS.escape(path) + '"]') } catch { return null } });
      if (targets.every(Boolean)) for (const target of targets) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, metaKey: true }));
    }
  }));
  let scrollPending = false;
  window.addEventListener('scroll', () => {
    if (!restored || scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      const element = [...document.querySelectorAll('[data-path]')].find(el => {
        const rect = el.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
      });
      parent.postMessage({type:'selection-office-scroll', previewId, scrollY: window.scrollY, scrollX: window.scrollX,
        anchor: element ? {path:element.getAttribute('data-path'), offset:element.getBoundingClientRect().top} : undefined}, '*');
    });
  }, {passive:true});
  if (readOnly) {
    // Block selection gestures before OfficeCLI can update its own decorations,
    // while keeping wheel scrolling and reading navigation available.
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) document.addEventListener(type, event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  const isTextInput = target => target instanceof Element && target.closest('input, textarea, [contenteditable="true"]');
  document.addEventListener('selectstart', event => {
    if (!isTextInput(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('mousedown', event => {
    if (event.button === 0 && !isTextInput(event.target)) window.getSelection()?.removeAllRanges();
  }, true);
  window.EventSource = class extends EventTarget { close() {} };
  window.fetch = async (url, options) => {
    if (readOnly) throw new Error('Draft preview is read only');
    if (url !== '/api/selection' || options?.method !== 'POST') throw new Error('Preview is read only');
    const value = JSON.parse(options.body);
    // Watch normally refreshes rubber-band outlines via SSE. This isolated
    // snapshot has no SSE connection, so repaint its current selection here.
    window._officecliReapplyDecorations?.();
    parent.postMessage({type:'selection-office-selection', previewId, paths:value.paths}, '*');
    return new Response('{}', {status:200});
  };
  document.addEventListener('click', e => { if (e.target.closest?.('a')) e.preventDefault(); }, true);
  document.addEventListener('submit', e => e.preventDefault(), true);
})();
</script>${math}`
  // Prepend policy and bridge before any scripts supplied by OfficeCLI.
  return `<!doctype html><html><head>${bridge}</head><body>${html}</body></html>`
}
