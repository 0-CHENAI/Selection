import { expect, it, spyOn } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as mammoth from 'mammoth'
import { readWorkbenchFile } from '../workbench-material-file'

it('preserves DOCX footnotes while disabling external file access and image reads', async () => {
  const packageRoot = dirname(createRequire(import.meta.url).resolve('mammoth/package.json'))
  const bytes = readFileSync(join(packageRoot, 'test/test-data/footnotes.docx'))
  const convert = mammoth.convertToHtml
  const adapter = spyOn(mammoth, 'convertToHtml').mockImplementation((input, options) => {
    expect(options?.externalFileAccess).toBe(false)
    expect(options?.convertImage).toBeDefined()
    // Bun resolves the Node entry; production Vite resolves Mammoth's browser
    // entry. Adapt only its input container and exercise the real converter.
    return convert({ buffer: Buffer.from((input as { arrayBuffer: ArrayBuffer }).arrayBuffer) }, options)
  })
  try {
    const result = await readWorkbenchFile(new File([Uint8Array.from(bytes)], 'footnotes.docx'))
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(result.text).toContain('Ouch[1].[2]')
    expect(result.text).toContain('A tachyon walks into a bar.')
    expect(result.text).toContain('Fin.')
    expect(Buffer.from(result.base64, 'base64')).toEqual(bytes)
  } finally { adapter.mockRestore() }
})

it('extracts HTML text without mounting or requesting embedded resources', async () => {
  const html = '<html><head><title>Hidden title</title></head><body><h1>Title</h1><script>bad()</script><p>A &amp; B</p><img src="https://invalid.invalid/pixel"><iframe src="https://invalid.invalid/frame"></iframe></body></html>'
  const result = await readWorkbenchFile(new File([html], 'page.html', { type: 'text/html' }))
  expect(result.text).toBe('Title\nA & B\n')
  expect(atob(result.base64)).toBe(html)
})

it('retains Unicode source and rejects binary data masquerading as text', async () => {
  const text = '中文材料\nconst greeting = "hello"'
  const result = await readWorkbenchFile(new File([text], 'source.ts'))
  expect(result.text).toBe(text)
  await expect(readWorkbenchFile(new File([new Uint8Array([0, 1, 2])], 'source.txt'))).rejects.toThrow('binary')
})
