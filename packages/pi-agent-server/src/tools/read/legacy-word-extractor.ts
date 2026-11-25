import { open } from 'node:fs/promises'
import WordExtractor from 'word-extractor'
import { LEGACY_WORD_MAX_SOURCE_BYTES, LEGACY_WORD_MAX_TEXT_BYTES } from './read-legacy-word.ts'

const COMPOUND_FILE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex')

async function extractText(path: string): Promise<string> {
  const handle = await open(path, 'r')
  let bytes: Buffer
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > LEGACY_WORD_MAX_SOURCE_BYTES) throw new Error('The source must be a regular file up to 128 MiB.')
    if (stat.size < 512) throw new Error('This is not a readable Word 97–2003 .doc file.')
    bytes = Buffer.alloc(stat.size)
    // The size is fixed before reading. A file being written should be retried after it is saved.
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) throw new Error('The .doc file changed while it was being read.')
      offset += bytesRead
    }
    const afterRead = await handle.stat()
    if (afterRead.size !== stat.size || afterRead.mtimeMs !== stat.mtimeMs) throw new Error('The .doc file changed while it was being read.')
  } finally {
    await handle.close()
  }
  if (!bytes.subarray(0, COMPOUND_FILE_SIGNATURE.length).equals(COMPOUND_FILE_SIGNATURE)) throw new Error('This is not a Word 97–2003 binary .doc file.')

  try {
    // The runtime accessors accept filterUnicode, which the public typings omit.
    const options = { filterUnicode: false, includeHeadersAndFooters: false }
    type ReadSection = (settings: typeof options) => string
    const doc: Record<'getBody' | 'getTextboxes' | 'getFootnotes' | 'getEndnotes', ReadSection> = await new WordExtractor().extract(bytes)
    const sections = [
      doc.getBody(options),
      doc.getTextboxes(options),
      doc.getFootnotes(options),
      doc.getEndnotes(options),
    ].filter(section => section.trim())
    const text = sections.join('\n\n').replace(/\r\n?/g, '\n')
    if (Buffer.byteLength(text) > LEGACY_WORD_MAX_TEXT_BYTES) throw new Error('Extracted text exceeds 32 MiB.')
    return text
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read binary Word text. The file may be damaged, encrypted, or unsupported. ${detail}`)
  }
}

if (import.meta.main) {
  try {
    process.stdout.write(await extractText(process.argv[2]!))
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
