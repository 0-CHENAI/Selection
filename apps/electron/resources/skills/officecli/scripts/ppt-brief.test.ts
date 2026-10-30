import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getOfficecliWrapperDir } from '../../../../../../packages/shared/src/utils/officecli'
import { buildPptBrief, sourceDigest, verifyPptBrief } from './ppt-brief'

const shape = (id: number, text: string, title = false) => ({ path: `/slide[1]/shape[@id=${id}]`, type: 'shape', text, format: { id, isTitle: title, x: '2cm', y: '3cm' } })
const query = (children: unknown[]) => ({ success: true, data: { matches: 2, results: [
  { path: '/slide[1]', type: 'slide', childCount: children.length, children },
  { path: '/slide[2]', type: 'slide', childCount: 0, children: [] },
] } })
const source = { path: '/fixture.pptx', sha256: 'fixture-hash' }

test('brief preserves empty pages and stable edit paths, and labels claims as unverified candidates', () => {
  const brief = buildPptBrief(query([shape(2, 'Small footer'), shape(3, 'Demand grew 20%', true)]), source)
  expect(brief.lossy).toBe(true)
  expect(brief.pages).toHaveLength(2)
  expect(brief.pages[0]!.claim).toEqual({ text: 'Demand grew 20%', sourcePath: '/slide[1]/shape[@id=3]', basis: 'title-placeholder', needsReview: true })
  expect(brief.pages[1]!.claim).toBeNull()
  expect(brief.pages[0]!.shapes[1]!.format.x).toBe('2cm')
})

test('missing titles use an explicit first-text fallback, without inventing narrative', () => {
  const brief = buildPptBrief(query([shape(2, ''), shape(3, 'Raw document text')]), source)
  expect(brief.pages[0]!.claim?.basis).toBe('first-text')
  expect(brief.pages[0]!.claim?.needsReview).toBe(true)
})

test('partial children are exposed and incomplete or failed query envelopes are rejected', () => {
  const value = query([])
  value.data.results[0]!.childCount = 4
  expect(buildPptBrief(value, source).pages[0]!.childrenIncomplete).toBe(true)
  expect(() => buildPptBrief({ success: false }, source)).toThrow()
  expect(() => buildPptBrief({ success: true, data: { matches: 3, results: [] } }, source)).toThrow()
  value.data.results[1]!.path = '/slide[3]'
  expect(() => buildPptBrief(value, source)).toThrow('Missing slides')
})

test('brief verification detects changed sources rather than trusting a stale inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-stale-')), file = join(dir, 'source.pptx')
  try {
    writeFileSync(file, 'initial')
    const brief = buildPptBrief(query([]), { path: realpathSync(file), sha256: sourceDigest(file) })
    expect(() => verifyPptBrief(file, brief)).not.toThrow()
    writeFileSync(file, 'changed')
    expect(() => verifyPptBrief(file, brief)).toThrow('stale')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test.skipIf(process.env.OFFICECLI_INTEGRATION !== '1')('real OfficeCLI sample yields identical briefs without changing the original', async () => {
  const root = resolve(import.meta.dir, '../../../../../..')
  const directory = getOfficecliWrapperDir()
  if (!directory) throw new Error('Packaged OfficeCLI wrapper missing')
  const binary = join(directory, process.platform === 'win32' ? 'officecli.cmd' : 'officecli')
  const file = join(root, 'apps/electron/resources/officecli/1.0.157/skills/morph-ppt/reference/styles/light--minimal-product/light__minimal_product.pptx')
  const dir = mkdtempSync(join(tmpdir(), 'brief-live-'))
  try {
    const before = sourceDigest(file)
    for (const name of ['first', 'second']) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'ppt-brief.ts'), file, '--out', join(dir, `${name}.json`), '--officecli', binary], { stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw new Error(stderr || stdout)
    }
    expect(readFileSync(join(dir, 'first.json'))).toEqual(readFileSync(join(dir, 'second.json')))
    const brief = JSON.parse(readFileSync(join(dir, 'first.json'), 'utf8'))
    expect(brief.pages).toHaveLength(6)
    expect(brief.pages.reduce((n: number, page: { shapes: unknown[] }) => n + page.shapes.length, 0)).toBe(222)
    expect(sourceDigest(file)).toBe(before)
    expect(() => verifyPptBrief(file, brief)).not.toThrow()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
