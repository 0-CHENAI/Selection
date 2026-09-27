/// <reference path="./pdf-worker.d.ts" />
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { unzipSync } from 'fflate'
import { XMLValidator } from 'fast-xml-parser'
import sharp from 'sharp'
import { createHash } from 'node:crypto'

export interface FileValidation { checks: string[]; scope: 'format'; semanticVerified: false; hash: string }
const textExtensions = new Set(['.txt','.md','.mdx','.csv','.tsv','.json','.jsonc','.html','.htm','.xml','.svg','.css','.scss','.less','.js','.jsx','.ts','.tsx','.mjs','.cjs','.py','.rs','.go','.java','.c','.cpp','.h','.sh','.yaml','.yml','.toml','.sql'])
const officePart: Record<string,string> = { '.docx':'word/document.xml','.xlsx':'xl/workbook.xml','.pptx':'ppt/presentation.xml' }

/** File/format checks only. Project checks and user acceptance remain separate. */
export async function validateCandidateFile(path: string): Promise<FileValidation> {
  const extension = extname(path).toLowerCase()
  const bytes = await readFile(path)
  const checks: string[] = []
  if (officePart[extension]) {
    const parts = unzipSync(bytes)
    for (const required of ['[Content_Types].xml','_rels/.rels',officePart[extension]!]) {
      if (!parts[required]) throw new Error(`Office package is missing ${required}`)
    }
    for (const [name, content] of Object.entries(parts)) {
      if (!/\.(xml|rels)$/i.test(name)) continue
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(content)
      if (XMLValidator.validate(xml) !== true) throw new Error(`Office package contains invalid XML: ${name}`)
    }
    checks.push('Office ZIP package and XML parts parsed')
  } else if (extension === '.pdf') {
    // Match the existing Pi PDF reader: bundle the worker instead of resolving
    // a sibling pdf.worker.mjs that does not exist beside the packaged server.
    const runtime = globalThis as typeof globalThis & { pdfjsWorker?: unknown }
    runtime.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true })
    try {
      const document = await task.promise
      if (document.numPages < 1) throw new Error('PDF contains no pages')
      for (let page = 1; page <= document.numPages; page++) await (await document.getPage(page)).getTextContent()
      checks.push('PDF pages parsed')
    } finally { await task.destroy() }
  } else if (['.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff','.avif'].includes(extension)) {
    await sharp(bytes, { failOn: 'error' }).raw().toBuffer()
    checks.push('Image decoded')
  } else if (textExtensions.has(extension)) {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (extension === '.json') { JSON.parse(content); checks.push('JSON parsed') }
    else if (extension === '.xml' || extension === '.svg') {
      if (XMLValidator.validate(content) !== true) throw new Error('Invalid XML')
      checks.push('XML parsed')
    } else checks.push('UTF-8 decoded')
  } else throw new Error('No format validator is available; the candidate is preserved for review')
  return { checks, scope: 'format', semanticVerified: false, hash: createHash('sha256').update(bytes).digest('hex') }
}
