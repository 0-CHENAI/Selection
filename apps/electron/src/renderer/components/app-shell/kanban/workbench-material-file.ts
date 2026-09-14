/** Local-only material extraction. No hosted conversion, analytics, or sharing service. */
export async function workbenchPdf() {
  const [pdf, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdf.GlobalWorkerOptions.workerSrc = worker.default
  return pdf
}

export async function readWorkbenchFile(file: File): Promise<{ name: string; mimeType: string; base64: string; text: string; pages?: Array<{ page: number; text: string }> }> {
  if (file.size > 32 * 1024 * 1024) throw new Error('Material exceeds the 32 MiB upload safety limit')
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)))
  const base64 = btoa(chunks.join(''))
  const name = file.name
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
    const pdf = await workbenchPdf()
    const task = pdf.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true })
    try {
      const document = await task.promise
      const pages: Array<{ page: number; text: string }> = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push({ page: pageNumber, text: content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('') })
        page.cleanup()
      }
      return { name, mimeType: 'application/pdf', base64, pages, text: pages.map(page => page.text).join('\n\n') }
    } finally { await task.destroy() }
  }
  if (/\.docx$/i.test(name)) {
    const mammoth = await import('mammoth')
    const { extractWorkbenchHtml } = await import('./workbench-html')
    // Raw-text extraction omits notes. HTML conversion preserves footnotes and
    // endnotes; parse it as data only, never mount untrusted document markup.
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    })
    return { name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64, text: extractWorkbenchHtml(result.value) }
  }
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return { name, mimeType: file.type, base64, text: '' }
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  if (/\.html?$/i.test(name) || file.type === 'text/html') {
    // A pure parser has no browser document: source URLs cannot trigger network fetches.
    const { extractWorkbenchHtml } = await import('./workbench-html')
    return { name, mimeType: 'text/html', base64, text: extractWorkbenchHtml(decoded) }
  }
  if (decoded.includes('\0')) throw new Error('Unsupported binary material format')
  return { name, mimeType: file.type || 'text/plain', base64, text: decoded }
}
