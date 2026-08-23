import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync } from 'fflate'
import {
  importSkillMarkdown,
  importSkillZip,
  previewSkillMarkdown,
  previewSkillZip,
} from '../import-skill-files.ts'
import { loadSkillBySlug } from '../../skills/storage.ts'

const SKILL_MD = `---
name: Office Helper
description: Helps with office documents.
---

# Hello
`

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'skill-import-'))
}

describe('skill file import (#82)', () => {
  it('imports a standalone SKILL.md', () => {
    const root = workspace()
    try {
      const preview = previewSkillMarkdown(SKILL_MD, root)
      expect(preview.suggestedSlug).toBe('office-helper')
      expect(preview.conflict).toBe(false)
      const result = importSkillMarkdown(root, SKILL_MD, { action: 'overwrite' })
      expect(result.skipped).toBe(false)
      expect(loadSkillBySlug(root, result.slug)?.metadata.name).toBe('Office Helper')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('imports a zip with SKILL.md one folder down plus extra files', () => {
    const root = workspace()
    try {
      const zip = zipSync({
        'office-helper/SKILL.md': new TextEncoder().encode(SKILL_MD),
        'office-helper/scripts/run.sh': new TextEncoder().encode('echo hi\n'),
      })
      const { preview } = previewSkillZip(zip, root)
      expect(preview.files).toEqual(['SKILL.md', 'scripts/run.sh'])
      const result = importSkillZip(root, zip, { action: 'overwrite' })
      const loaded = loadSkillBySlug(root, result.slug)
      expect(loaded?.metadata.description).toContain('office documents')
      expect(readFileSync(join(root, 'skills', result.slug, 'scripts', 'run.sh'), 'utf8')).toContain('echo hi')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects zip path traversal and missing frontmatter', () => {
    const root = workspace()
    try {
      expect(() => previewSkillMarkdown('---\ntitle: x\n---\n', root)).toThrow(/name or description/)
      const zip = zipSync({
        '../escape/SKILL.md': new TextEncoder().encode(SKILL_MD),
      })
      expect(() => previewSkillZip(zip, root)).toThrow(/not allowed|does not contain/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
