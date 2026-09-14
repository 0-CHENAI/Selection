/// <reference path="./pdf-worker.d.ts" />
import { extractWorkbenchHtml } from './html.ts';

/** Local, tool-free parsing. Never executes document scripts or fetches linked resources. */
export async function extractWorkbenchFile(bytes: Uint8Array, name: string, mimeType: string): Promise<{ text: string; pages?: Array<{ page: number; text: string }> }> {
  if (/\.pdf$/i.test(name) || mimeType === 'application/pdf') {
    // Text-only PDF.js still constructs a DOMMatrix at module initialization.
    // Bundle its pure-JS geometry implementation, not a native canvas binding.
    if (!Reflect.get(globalThis, 'DOMMatrix')) {
      const geometry = await import('@napi-rs/canvas/geometry.js');
      Reflect.set(globalThis, 'DOMMatrix', geometry.DOMMatrix);
    }
    // The explicit import registers the bundled in-process worker handler.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdf.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
    try {
      const document = await task.promise;
      const pages: Array<{ page: number; text: string }> = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          pages.push({ page: number, text: content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('') });
        } finally { page.cleanup(); }
      }
      return { pages, text: pages.map(page => page.text).join('\n\n') };
    } finally { await task.destroy(); }
  }
  if (/\.docx$/i.test(name) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { externalFileAccess: false, convertImage: mammoth.images.imgElement(async () => ({ src: '' })) });
    return { text: extractWorkbenchHtml(result.value) };
  }
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') return { text: '' };
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error(`Unsupported binary material: ${name}`);
  return { text: /\.html?$/i.test(name) || mimeType === 'text/html' ? extractWorkbenchHtml(text) : text };
}
