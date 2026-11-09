import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  DSH_BASELINE,
  DSH_PREVIOUS_SNAPSHOT,
  buildInventory,
  classifyPath,
  renderInventoryMarkdown,
  serializeInventory,
} from './dsh-office-inventory'

const root = join(import.meta.dir, '..')
const jsonPath = join(root, 'docs/plans/dsh-office-inventory.json')
const markdownPath = join(root, 'docs/plans/dsh-office-inventory.md')

const REQUIRED = [
  'packages/dsh-desktop-office/lib/modes.js',
  'packages/dsh-desktop-office/lib/templates.js',
  'packages/dsh-desktop-office/lib/template-tool.js',
  'packages/dsh-desktop-office/lib/template-writer.js',
  'packages/dsh-desktop-office/lib/docx-workflow.js',
  'packages/dsh-desktop-office/lib/docx-layout.py',
  'packages/dsh-desktop-office/lib/business-skills.js',
  'packages/dsh-desktop-office/client.js',
  'packages/dsh-desktop-office/index.js',
  'packages/dsh-desktop-office/sources/catalog.json',
  'packages/dsh-desktop-office/sources/curated/meeting-minutes/example.docx',
  'packages/dsh-desktop-office/sources/curated/meeting-minutes/design.md',
  'packages/dsh-desktop-office/sources/curated/meeting-minutes/preview-checks.json',
  'packages/dsh-desktop-office/sources/legacy/coffee-market/example.docx',
  'packages/dsh-desktop-office/sources/legacy/coffee-market/design.md',
  'packages/dsh-desktop-office/sources/legacy/equity-research/example.docx',
  'packages/dsh-desktop-office/sources/legacy/equity-research/design.md',
  'packages/dsh-desktop-office/sources/legacy/government-notice/example.docx',
  'packages/dsh-desktop-office/sources/legacy/government-notice/design.md',
  'packages/dsh-desktop-office/sources/legacy/government-notice/generation.json',
  'packages/dsh-desktop-office/sources/legacy/annual-business/example.xlsx',
  'packages/dsh-desktop-office/sources/legacy/annual-business/design.md',
  'packages/dsh-desktop-office/sources/legacy/port-cargo/example.xlsx',
  'packages/dsh-desktop-office/sources/legacy/port-cargo/checks.json',
  'packages/dsh-desktop-office/sources/legacy/bio-assay/example.xlsx',
  'packages/dsh-desktop-office/sources/legacy/bio-assay/checks.json',
  'packages/dsh-desktop-office/business-skills/gov-doc-writing/SKILL.md',
  'packages/dsh-desktop-office/business-skills/meeting-recap/SKILL.md',
  'packages/dsh-desktop-office/business-skills/meeting-recap/scripts/validate_minutes.py',
  'packages/dsh-desktop-office/business-skills/work-report-writer/SKILL.md',
  'packages/dsh-desktop-office/business-skills/research-writer/LICENSE.txt',
  'packages/dsh-desktop-office/business-skills/saas-metrics-coach/scripts/metrics_calculator.py',
  'packages/dsh-desktop-office/business-skills/dataset-health-audit/scripts/data_quality_checker.py',
  'packages/dsh-desktop-office/business-skills/data-viz-gen/scripts/build_infographic.py',
  'packages/ppt-runtime/core/lib/pptx-converter.js',
  'packages/ppt-runtime/core/lib/imported-shape-export.js',
  'packages/ppt-runtime/core/lib/imported-text-export.js',
  'packages/ppt-runtime/core/lib/personal-templates.js',
  'packages/ppt-runtime/core/lib/template-image-contract.js',
  'packages/ppt-runtime/core/lib/validation.js',
  'packages/ppt-runtime/core/lib/pptx-geometry-budget.js',
  'packages/ppt-runtime/core/lib/text-wrap.js',
  'packages/ppt-runtime/core/skills/dsh-ppt/SKILL.md',
  'packages/ppt-runtime/core/skills/dsh-ppt/references/pptd.md',
  'packages/ppt-runtime/core/skills/dsh-ppt/references/composition.md',
  'packages/ppt-runtime/client/personal-template-manager.js',
  'packages/ppt-runtime/core/THIRD_PARTY_NOTICES.md',
  'packages/ppt-runtime/excluded-assets.json',
  'packages/ppt-runtime/catalog-policy.json',
  'packages/dsh-image-generation/lib/provider.js',
  'packages/dsh-image-generation/lib/writer.js',
  'packages/dsh-image-generation/skills/generate-image/SKILL.md',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-office-to-pdf-0.2.0-rc.2.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-darwin-arm64-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-darwin-x64-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-win32-arm64-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-win32-x64-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-wasm-0.1.3.tgz',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz!package/assets/office-docx/SKILL.md',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz!package/assets/office-pptx/SKILL.md',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz!package/assets/office-xlsx/SKILL.md',
  'packages/harness-0.2.0-rc.2/npm-dsh/deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz!package/assets/scripts/check_office.py',
]

const B1_SAMPLE = [
  'packages/dsh-desktop-office/lib/docx-layout.py',
  'packages/dsh-desktop-office/sources/legacy/bio-assay/example.xlsx',
  'packages/ppt-runtime/core/lib/pptx-converter.js',
  'packages/ppt-runtime/core/lib/validation.js',
  'packages/ppt-runtime/core/skills/dsh-ppt/SKILL.md',
  'packages/dsh-desktop-office/sources/catalog.json',
  'packages/dsh-desktop-office/business-skills/gov-doc-writing/SKILL.md',
  'packages/dsh-image-generation/lib/provider.js',
  'packages/dsh-desktop-office/lib/template-tool.js',
  'packages/dsh-desktop-office/sources/legacy/port-cargo/checks.json',
]

const STAGE_ISSUE: Record<string, number> = {
  '02': 705, '03': 706, '04': 707, '05': 708, '06': 709, '07': 710, '08': 711,
  '09': 712, '10': 713, '11': 714, '12': 715, '13': 716, '14': 717, '15': 718,
}

function dshRepo(): string | undefined {
  const candidates = [process.env.DSH_DESKTOP_REPO, '/tmp/dsh-scratch/dsh-desktop'].filter((item): item is string => Boolean(item))
  return candidates.find(path => existsSync(join(path, '.git')))
}

function loadInventory() {
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as ReturnType<typeof buildInventory>
}

test('classification records the gov-doc decision and known licenses', () => {
  const gov = classifyPath('packages/dsh-desktop-office/business-skills/gov-doc-writing/SKILL.md')
  expect(gov.disposition).toBe('不搬')
  expect(gov.license).toBe('NOASSERTION')
  expect(gov.stage).toBe('07')
  expect(gov.note).toContain('能力参照 dsh-desktop gov-doc-writing，未复用其内容')
  const notice = classifyPath('packages/dsh-desktop-office/sources/legacy/government-notice/example.docx')
  expect(notice.disposition).toBe('不搬')
  expect(notice.license).toBe('NOASSERTION')
  expect(classifyPath('packages/dsh-desktop-office/business-skills/research-writer/LICENSE.txt').license).toBe('Apache-2.0')
  expect(classifyPath('packages/dsh-desktop-office/business-skills/meeting-recap/LICENSE').license).toBe('MIT')
  expect(classifyPath('packages/harness-0.2.0-rc.2/npm-vendor/deepseek-ai-libreoffice-kit-wasm-0.1.3.tgz').license).toBe('MPL-2.0')
  expect(classifyPath('packages/dsh-desktop-office/lib/docx-layout.py').disposition).toBe('决策后再定')
  expect(classifyPath('packages/dsh-desktop-office/business-skills/saas-metrics-coach/scripts/metrics_calculator.py').disposition).toBe('决策后再定')
})

test('committed inventory covers the 588412b Office scope', () => {
  const inventory = loadInventory()
  expect(inventory.dshCommit).toBe(DSH_BASELINE)
  expect(inventory.readOnly).toBe(true)
  expect(inventory.summary.dshDesktopOfficeCount).toBe(73)
  const paths = inventory.files.map(file => file.path)
  expect(paths).toEqual([...paths].sort())
  for (const path of REQUIRED) expect(paths).toContain(path)
  const gov = inventory.files.filter(file => file.path.includes('/gov-doc-writing/'))
  expect(gov.length).toBeGreaterThan(0)
  for (const file of gov) {
    expect(file.disposition).toBe('不搬')
    expect(file.license).toBe('NOASSERTION')
    expect(file.note).toContain('未复用其内容')
  }
  for (const file of inventory.files) {
    expect(STAGE_ISSUE[file.stage]).toBe(file.issue)
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(['案例', '技能', '工具', '引擎', 'UI', '运行时']).toContain(file.category)
    expect(['JS', 'Python', '二进制', '文档']).toContain(file.language)
    expect(['原样搬', '改写', '决策后再定', '不搬']).toContain(file.disposition)
  }
  const kits = inventory.files.filter(file => file.origin === 'git' && file.path.includes('libreoffice-kit') && file.path.endsWith('.tgz'))
  expect(kits).toHaveLength(6)
  for (const kit of kits) expect(kit.license).toBe('MPL-2.0')
})

describe('live dsh checkout', () => {
  const repo = dshRepo()
  test.skipIf(!repo)('B1 hashes match git show and the committed inventory regenerates', () => {
    const built = buildInventory(repo!, DSH_BASELINE)
    expect(serializeInventory(built)).toBe(readFileSync(jsonPath, 'utf8'))
    expect(renderInventoryMarkdown(built)).toBe(readFileSync(markdownPath, 'utf8'))
    const byPath = new Map(built.files.map(file => [file.path, file]))
    for (const path of B1_SAMPLE) {
      const shown = spawnSync('git', ['-C', repo!, 'show', `${DSH_BASELINE}:${path}`], { maxBuffer: 96 * 1024 * 1024 })
      expect(shown.status).toBe(0)
      const digest = createHash('sha256').update(Buffer.from(shown.stdout)).digest('hex')
      expect(digest).toBe(byPath.get(path)?.sha256)
    }
  }, 120_000)

  test.skipIf(!repo)('B2 old snapshot has no dsh-desktop-office entries', () => {
    const old = buildInventory(repo!, DSH_PREVIOUS_SNAPSHOT)
    expect(old.dshCommit).toBe(DSH_PREVIOUS_SNAPSHOT)
    expect(old.summary.dshDesktopOfficeCount).toBe(0)
    expect(old.files.some(file => file.path.includes('dsh-desktop-office'))).toBe(false)
    expect(old.files.some(file => file.path.includes('harness-0.2.0-rc.2'))).toBe(false)
  }, 180_000)
})
