import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectDeck } from './inspect-deck.mjs'

test('large deck inspection stays bounded and references original pages without modifying the template', async () => {
  const root = mkdtempSync(join(tmpdir(), 'inspect-deck-'))
  try {
    const source = JSON.stringify({ title: 'Template', pages: Array.from({ length: 100 }, (_, i) => ({
      id: `p${i + 1}`, name: 'N'.repeat(1000), notes: 'Evidence that must remain in the original',
      elements: Array.from({ length: 200 }, () => ({ type: 'text', text: 'X'.repeat(1000), bounds: { x: 1 } })),
    })) })
    const file = join(root, 'template.json'); writeFileSync(file, source)
    const result = inspectDeck(file, 7, 6)
    expect(result.pages).toHaveLength(6)
    expect(result.pages[0]).toMatchObject({ page: 7, sourcePath: 'pages[6]', id: 'p7', elements: 200 })
    expect(result.nextStart).toBe(13)
    expect(result.lossy).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThan(8000)
    expect(readFileSync(file, 'utf8')).toBe(source)
    expect(() => inspectDeck(file, 1, 100)).toThrow()
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'inspect-deck.mjs'), file, '99', '2'], { stdout: 'pipe', stderr: 'pipe' })
    expect(await proc.exited).toBe(0)
    expect(JSON.parse(await new Response(proc.stdout).text()).pages.map((p: { page: number }) => p.page)).toEqual([99, 100])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
