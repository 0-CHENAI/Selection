import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'

export const LEGACY_WORD_TIMEOUT_MS = 45_000
export const LEGACY_WORD_MAX_SOURCE_BYTES = 128 * 1024 * 1024
export const LEGACY_WORD_MAX_TEXT_BYTES = 32 * 1024 * 1024
const MAX_CACHE_BYTES = LEGACY_WORD_MAX_TEXT_BYTES
const MAX_CACHE_FILES = 8

const cache = new Map<string, { version: string; bytes: Buffer }>()
const pending = new Map<string, { controller: AbortController; result: Promise<Buffer>; readers: number }>()

async function fileVersion(path: string): Promise<string> {
  const info = await stat(path, { bigint: true })
  if (!info.isFile() || info.size > BigInt(LEGACY_WORD_MAX_SOURCE_BYTES)) {
    throw new Error('The source must be a regular file up to 128 MiB.')
  }
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

async function extractInChild(path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const deadline = AbortSignal.timeout(LEGACY_WORD_TIMEOUT_MS)
  const stop = AbortSignal.any([signal, deadline])
  const filename = import.meta.url.endsWith('.ts') ? 'legacy-word-extractor.ts' : 'legacy-word-extractor.js'
  const entry = fileURLToPath(new URL(filename, import.meta.url))
  // Word input is untrusted. A separate process lets us interrupt a stalled parser.
  const child = Bun.spawn([process.execPath, entry, path], {
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true, signal: stop,
  })
  const [exit, content, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ])
  signal.throwIfAborted()
  if (deadline.aborted) throw new Error(`Legacy Word text extraction timed out after ${LEGACY_WORD_TIMEOUT_MS / 1000} seconds.`)
  if (exit !== 0) throw new Error(`Legacy Word text extraction failed. ${stderr.trim().slice(0, 320) || 'The extractor exited without a result.'}`)
  return Buffer.from(content)
}

/** Cache extracted text for subsequent Read offsets, keyed by the original file version. */
export async function readLegacyWord(path: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  const version = await fileVersion(path)
  signal?.throwIfAborted()
  const cached = cache.get(path)
  cache.delete(path)
  if (cached?.version === version) {
    cache.set(path, cached)
    return cached.bytes
  }

  const key = `${path}\0${version}`
  let extraction = pending.get(key)
  if (!extraction) {
    const controller = new AbortController()
    const result = extractInChild(path, controller.signal).then(async bytes => {
      if (await fileVersion(path) !== version) throw new Error('The .doc file changed while it was being read.')
      controller.signal.throwIfAborted()
      cache.set(path, { version, bytes })
      let cachedBytes = [...cache.values()].reduce((sum, entry) => sum + entry.bytes.length, 0)
      for (const [oldestPath, entry] of cache) {
        if (cachedBytes <= MAX_CACHE_BYTES && cache.size <= MAX_CACHE_FILES) break
        cache.delete(oldestPath)
        cachedBytes -= entry.bytes.length
      }
      return bytes
    }).finally(() => {
      if (pending.get(key)?.controller === controller) pending.delete(key)
    })
    extraction = { controller, result, readers: 0 }
    pending.set(key, extraction)
  }

  const { controller, result } = extraction
  extraction.readers++
  let cancel: (() => void) | undefined
  try {
    if (!signal) return await result
    return await new Promise<Buffer>((resolve, reject) => {
      cancel = () => reject(signal.reason)
      signal.addEventListener('abort', cancel, { once: true })
      void result.then(resolve, reject)
    })
  } finally {
    if (cancel) signal?.removeEventListener('abort', cancel)
    if (--extraction.readers === 0 && pending.get(key) === extraction) {
      pending.delete(key)
      controller.abort()
      await result.catch(() => {})
    }
  }
}
