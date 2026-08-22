import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadAllSkills, loadSkillBySlug } from '../../skills/storage.ts'
import {
  BUNDLED_OFFICECLI_SKILL_SLUGS,
  getBundledOfficecliSkillsDir,
  resolveOfficecliBinary,
} from '../officecli.ts'

const requirePackagedRuntime = process.env.OFFICECLI_INTEGRATION === '1'

describe('bundled OfficeCLI skills', () => {
  const skillsDir = getBundledOfficecliSkillsDir()
  const binary = resolveOfficecliBinary()

  it('ships official SKILL.md folders next to the reviewed binary', () => {
    if (!skillsDir) {
      if (requirePackagedRuntime) throw new Error('bundled OfficeCLI skills directory is missing')
      return
    }

    for (const slug of BUNDLED_OFFICECLI_SKILL_SLUGS) {
      expect(existsSync(join(skillsDir, slug, 'SKILL.md'))).toBe(true)
    }
  })

  it('loads official skills as built-in bundled skills', () => {
    if (!skillsDir) {
      if (requirePackagedRuntime) throw new Error('bundled OfficeCLI skills directory is missing')
      return
    }

    const workspaceRoot = mkdtempSync(join(tmpdir(), 'officecli-bundled-skills-'))
    try {
      const all = loadAllSkills(workspaceRoot)
      for (const slug of BUNDLED_OFFICECLI_SKILL_SLUGS) {
        const skill = loadSkillBySlug(workspaceRoot, slug)
        expect(skill?.source).toBe('bundled')
        expect(skill?.path).toBe(join(skillsDir, slug))
        expect(all.some(item => item.slug === slug && item.source === 'bundled')).toBe(true)
      }
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('resolves the packaged officecli binary', () => {
    if (!binary) {
      if (requirePackagedRuntime) throw new Error('packaged officecli binary is missing')
      return
    }

    expect(existsSync(binary)).toBe(true)
    const result = Bun.spawnSync([binary, '--version'], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toMatch(/\d+\.\d+/)
  })
})
