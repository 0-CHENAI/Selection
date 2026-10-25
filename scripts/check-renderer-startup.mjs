// Exercise the real Vite renderer entry graph with an empty dependency cache.
// Production Rollup builds and warm component fixtures do not catch cold scans.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { createServer } from 'vite'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cache = await mkdtemp(join(tmpdir(), 'selection-renderer-cold-'))
let server
try {
  server = await createServer({
    configFile: join(root, 'apps/electron/vite.config.ts'),
    cacheDir: cache,
    optimizeDeps: { force: true },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'warn',
  })
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const page = await fetch(`${base}/index.html`, { signal: AbortSignal.timeout(60000) })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /id="_loader"/)
  const entry = await fetch(`${base}/main.tsx`, { signal: AbortSignal.timeout(60000) })
  assert.equal(entry.status, 200, 'the real application entry transforms successfully')
  let metadata
  for (let attempt = 0; attempt < 240; attempt++) {
    try { metadata = JSON.parse(await readFile(join(cache, 'deps/_metadata.json'), 'utf8')); break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await setTimeout(250)
  }
  assert.ok(metadata, 'cold dependency optimization completed within 60 seconds')
  assert.ok(metadata.optimized['electron-log/renderer'], 'renderer logging is still prebundled')
  assert.ok(!metadata.optimized['electron-log/main'], 'Node logging must stay out of the renderer graph')
  console.log(`PASS: renderer cold dependency scan/prebundle on ${process.version}; renderer logger retained, Node logger absent`)
} finally {
  await server?.close()
  await rm(cache, { recursive: true, force: true })
}
