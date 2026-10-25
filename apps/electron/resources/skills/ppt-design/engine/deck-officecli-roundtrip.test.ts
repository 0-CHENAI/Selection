import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { resolveOfficecliBinary } from '../../../../../../packages/shared/src/utils/officecli.ts'
import { fixtureTheme, makeDeck, makePage, text } from '../styles/kit.ts'
import { exportDeck } from './export-pptx.ts'

const OFFICECLI_ENV = { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }

async function officecli(binary: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([binary, ...args], { env: OFFICECLI_ENV, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(stderr || stdout || `officecli exited ${code}`)
  return stdout
}

/** Paths the Office preview paints as data-path, which a click sends to the selection bridge. */
async function previewShapePaths(binary: string, file: string): Promise<string[]> {
  const proc = Bun.spawn([binary, 'watch', file, '--port', '0'], { env: OFFICECLI_ENV, stdout: 'pipe', stderr: 'pipe' })
  const reader = proc.stdout.getReader()
  const errors = proc.stderr.getReader()
  void (async () => { try { while (!(await errors.read()).done) { /* drain */ } } catch { /* closed */ } })()
  const timer = setTimeout(() => proc.kill(), 20_000)
  try {
    const decoder = new TextDecoder()
    let output = ''
    let port = 0
    while (!port) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
      port = Number(output.match(/Watch: http:\/\/localhost:(\d+)/)?.[1] ?? 0)
    }
    if (!port) throw new Error(output || 'officecli watch did not start')
    const html = await fetch(`http://127.0.0.1:${port}/`).then(response => response.text())
    const paths = [...html.matchAll(/data-path=(?:"([^"]+)"|'([^']+)')/g)].map(match =>
      (match[1] ?? match[2] ?? '').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'),
    ).filter(path => path.includes('shape'))
    if (paths.length === 0) throw new Error(`preview has no shape paths (${html.length} bytes)`)
    return paths
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => undefined)
    proc.kill()
    await proc.exited
  }
}

describe('deck element ids round-trip as OfficeCLI shape names', () => {
  it('writes the element id into the shape name and OfficeCLI can read and replace that text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-shape-'))
    const out = join(dir, 'deck.pptx')
    try {
      const deck = makeDeck('往返', fixtureTheme, [
        makePage('p1', 'free', '标题页', '$paper', [
          text('title-el', '原始标题', 48, 40, 400, 48, 24, { bold: true }),
        ], ''),
      ])
      const result = await exportDeck(deck, out, { enforceCheck: false })
      expect(result.pptx).toBeTruthy()
      const xml = Buffer.from(unzipSync(readFileSync(out))['ppt/slides/slide1.xml']!).toString('utf8')
      expect(xml).toContain('name="title-el"')
      const binary = resolveOfficecliBinary()
      if (!binary) {
        if (process.env.OFFICECLI_INTEGRATION === '1') throw new Error('officecli binary missing')
        return
      }
      const named = JSON.parse(await officecli(binary, ['get', out, '/slide[1]/shape[@name=title-el]', '--json'])) as {
        data: { results: Array<{ path: string; text?: string; format?: { name?: string } }> }
      }
      expect(named.data.results[0]?.format?.name).toBe('title-el')
      expect(named.data.results[0]?.text).toBe('原始标题')
      const paths = await previewShapePaths(binary, out)
      let clickPath = ''
      for (const path of paths) {
        const body = await officecli(binary, ['get', out, path, '--json'])
        if (body.includes('"name": "title-el"') && body.includes('原始标题')) { clickPath = path; break }
      }
      expect(clickPath).not.toBe('')
      await officecli(binary, ['set', out, clickPath, '--prop', 'text=改后的标题'])
      const after = JSON.parse(await officecli(binary, ['get', out, '/slide[1]/shape[@name=title-el]', '--json'])) as typeof named
      expect(after.data.results[0]?.text).toBe('改后的标题')
      expect(after.data.results[0]?.format?.name).toBe('title-el')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
