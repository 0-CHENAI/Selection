import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactCandidateInventory } from './artifact-candidate-inventory'
import { reviewArtifactDelivery } from './artifact-delivery-review'

test('the filesystem ledger finds created and edited Chinese paths without treating old input as an output', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-inventory-'))
  try {
    const data = join(root, 'data.json')
    const report = join(root, '中文 报告 (1).html')
    const helper = join(root, 'helper.ts')
    writeFileSync(data, '{}')
    writeFileSync(helper, 'before')
    const inventory = new ArtifactCandidateInventory([root])
    writeFileSync(report, '<html>hello</html>')
    writeFileSync(helper, 'after')
    expect(inventory.changed().sort()).toEqual([helper, report].sort())
    expect(inventory.changed()).not.toContain(data)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the reviewer classifies every candidate and keeps only primary results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-review-'))
  try {
    const report = join(root, '六月报告.html')
    const helper = join(root, 'build.js')
    mkdirSync(root, { recursive: true })
    writeFileSync(report, '<html><body>report</body></html>')
    writeFileSync(helper, 'console.log(1)')
    const input = { request: '生成一份报告', answer: '报告完成', candidates: [report, helper], proposed: [] }
    const result = await reviewArtifactDelivery(input, async request => {
      expect((JSON.parse(request.prompt) as { files: Array<{ path: string }> }).files[0]?.path).toBe(report)
      return { text: JSON.stringify({ decisions: [
        { id: 1, role: 'primary', reason: 'Final report' },
        { id: 2, role: 'supporting', reason: 'Build helper' },
      ] }) }
    })
    expect(result).toEqual([report])
    await expect(reviewArtifactDelivery(input, async () => ({ text: JSON.stringify({ decisions: [
      { id: 1, role: 'primary', reason: 'Final report' },
    ] }) }))).rejects.toThrow('classify every candidate')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a large change ledger is reviewed in slices without dropping later files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-review-many-'))
  try {
    const candidates = Array.from({ length: 41 }, (_, index) => {
      const path = join(root, `candidate-${index}.txt`)
      writeFileSync(path, String(index))
      return path
    })
    let calls = 0
    const selected = await reviewArtifactDelivery({ request: '交付最后一份报告', answer: '完成', candidates, proposed: [] }, async request => {
      calls++
      const files = (JSON.parse(request.prompt) as { files: Array<{ id: number; path: string }> }).files
      return { text: JSON.stringify({ decisions: files.map(file => ({ id: file.id,
        role: file.path === candidates[40] ? 'primary' : 'supporting', reason: 'Reviewed',
      })) }) }
    })
    expect(calls).toBe(2)
    expect(selected).toEqual([candidates[40]])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
