import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { OfficePreviewService, OFFICE_SAMPLE_READ_ONLY } from '../reliability/office-preview'
import {
  isOfficeCasePreviewPath,
  matchOfficeCasePreview,
  officeCasePreviewScopeDir,
  officeCaseSamples,
  prepareOfficeCasePreview,
  removeOfficeCasePreviews,
} from './office-case-preview'

const root = join(import.meta.dir, '../../../../apps/electron/resources/skills/office-business')
const temps: string[] = []
const services: OfficePreviewService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})
async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'office-case-preview-'))
  temps.push(dir)
  return dir
}

test('every Word / Excel case that ships a file has a verified sample', () => {
  const samples = officeCaseSamples(root)
  expect(samples.map(item => item.id).sort()).toEqual(['annual-business', 'bio-assay', 'coffee-market', 'equity-research', 'government-notice', 'meeting-minutes', 'port-cargo'])
  for (const item of samples) {
    const bytes = readFileSync(join(root, item.dir, item.sampleFile))
    if (item.sha256) expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256)
  }
  // Selection 样例 entries have no file, so they get no preview button and no copy.
  expect(samples.some(item => item.id.startsWith('selection-') || item.id === 'execution-tracker')).toBe(false)
})

test('a case preview is a private read-only copy the client cannot choose the path of', async () => {
  const temp = await tempRoot()
  const sample = await prepareOfficeCasePreview('ws-1', 'chat-1', 'coffee-market', { root, tempRoot: temp })
  expect(sample.path.startsWith(officeCasePreviewScopeDir('ws-1', 'chat-1', temp))).toBe(true)
  expect(sample.path.endsWith('中国现制咖啡市场调研报告.docx')).toBe(true)
  expect(sample.bytes.equals(readFileSync(join(root, 'cases/coffee-market/example.docx')))).toBe(true)
  if (process.platform !== 'win32') expect(statSync(sample.path).mode & 0o222).toBe(0)
  expect(isOfficeCasePreviewPath(sample.path, temp)).toBe(true)

  // Same path again: allowed, still the bundled bytes.
  const again = await matchOfficeCasePreview('ws-1', 'chat-1', sample.path, { root, tempRoot: temp })
  expect(again?.caseId).toBe('coffee-market')
  // Another chat, another workspace, a sibling file or a traversal: not a case preview.
  expect(await matchOfficeCasePreview('ws-1', 'chat-2', sample.path, { root, tempRoot: temp })).toBeUndefined()
  expect(await matchOfficeCasePreview('ws-2', 'chat-1', sample.path, { root, tempRoot: temp })).toBeUndefined()
  expect(await matchOfficeCasePreview('ws-1', 'chat-1', join(sample.path, '..', 'other.docx'), { root, tempRoot: temp })).toBeUndefined()
  expect(await matchOfficeCasePreview('ws-1', 'chat-1', join(sample.path, '..', '..', '..', 'x.docx'), { root, tempRoot: temp })).toBeUndefined()
  expect(await matchOfficeCasePreview('ws-1', 'chat-1', '/etc/passwd', { root, tempRoot: temp })).toBeUndefined()

  await expect(prepareOfficeCasePreview('ws-1', 'chat-1', '../coffee-market', { root, tempRoot: temp })).rejects.toThrow('不存在')
  await expect(prepareOfficeCasePreview('ws-1', 'chat-1', 'selection-work-notice', { root, tempRoot: temp })).rejects.toThrow('没有样例')
})

test('a tampered copy is restored from the bundled sample before it is shown', async () => {
  const temp = await tempRoot()
  const sample = await prepareOfficeCasePreview('ws', '@office-case', 'port-cargo', { root, tempRoot: temp })
  chmodSync(sample.path, 0o600)
  writeFileSync(sample.path, 'tampered')
  const restored = await matchOfficeCasePreview('ws', '@office-case', sample.path, { root, tempRoot: temp })
  expect(restored?.bytes.equals(readFileSync(join(root, 'cases/port-cargo/example.xlsx')))).toBe(true)
  expect(readFileSync(sample.path).equals(restored!.bytes)).toBe(true)
  await removeOfficeCasePreviews('ws', '@office-case', temp)
  expect(existsSync(sample.path)).toBe(false)
})

const runtime = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
test.skipIf(!runtime)('real OfficeCLI shows a case sample read-only', async () => {
  const temp = await tempRoot()
  const sample = await prepareOfficeCasePreview('ws', 'chat', 'government-notice', { root, tempRoot: temp })
  const service = new OfficePreviewService(); services.push(service)
  const preview = await service.open('chat', `office-case:${sample.caseId}`, sample.revision, sample.path, sample.bytes, false, true, 'client', undefined, { readOnly: true })
  expect(preview.readOnly).toBe(true)
  expect(preview.html).toContain('质量安全月')
  await expect(service.select('chat', preview.previewId, ['/body/p[1]'], 'client')).rejects.toThrow(OFFICE_SAMPLE_READ_ONLY)
  await expect(service.capture('chat', preview.previewId, 'client')).rejects.toThrow(OFFICE_SAMPLE_READ_ONLY)
  expect((await service.heartbeat('chat', preview.previewId, 'client')).readOnly).toBe(true)
}, 60_000)
