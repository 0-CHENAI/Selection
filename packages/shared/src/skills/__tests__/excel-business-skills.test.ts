import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { toSkillCatalogEntries } from '../catalog.ts'
import { loadAllSkills } from '../storage.ts'

describe('Excel business skills', () => {
  test('saas-metrics-coach, dataset-health-audit and data-viz-gen are callable from the catalog', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'excel-skills-'))
    const skills = loadAllSkills(workspace)
    const catalog = toSkillCatalogEntries(skills)
    for (const slug of ['saas-metrics-coach', 'dataset-health-audit', 'data-viz-gen']) {
      const skill = skills.find(item => item.slug === slug && item.source === 'bundled')
      const entry = catalog.find(item => item.slug === slug)
      expect(skill?.metadata.description.length).toBeGreaterThan(20)
      expect(entry?.skillMdPath.endsWith(`${slug}/SKILL.md`)).toBe(true)
      expect(skill?.content.includes('xlsx_recalculate')).toBe(true)
      expect(skill?.content.includes('python3 scripts/')).toBe(false)
    }
  })
})
