import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DISPLAY_TITLE_MAX_LENGTH,
  DISPLAY_TITLES_FILE,
  DisplayTitleValidationError,
  formatSourceRef,
  matchesTitleSearch,
  normalizeDisplayTitle,
  resolveSkillTitle,
  resolveSourceTitle,
} from '../display-titles.ts'
import {
  clearDisplayTitle,
  getDisplayTitle,
  loadDisplayTitles,
  setDisplayTitle,
} from '../display-titles-storage.ts'
import { deleteSource, loadSource } from '../sources/storage.ts'
import { deleteSkill, invalidateSkillsCache, loadAllSkills, loadSkillBySlug } from '../skills/storage.ts'

let workspaceRoot: string
const tempDirs: string[] = []

function createSource(slug: string, name: string): void {
  const sourceDir = join(workspaceRoot, 'sources', slug)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    join(sourceDir, 'config.json'),
    JSON.stringify({
      id: `${slug}_test`,
      name,
      slug,
      enabled: true,
      provider: 'custom',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp' },
      createdAt: 1,
      updatedAt: 1,
    }),
  )
}

function createSkill(slug: string, name: string): void {
  const skillDir = join(workspaceRoot, 'skills', slug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: "${name}"
description: "A ${slug} skill"
---

Instructions for ${slug}
`,
  )
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'display-titles-'))
  tempDirs.push(workspaceRoot)
  invalidateSkillsCache()
})

afterEach(() => {
  invalidateSkillsCache()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('normalizeDisplayTitle', () => {
  it('treats empty and whitespace as restore-default', () => {
    expect(normalizeDisplayTitle('')).toEqual({ ok: true, value: null })
    expect(normalizeDisplayTitle('   ')).toEqual({ ok: true, value: null })
    expect(normalizeDisplayTitle(null)).toEqual({ ok: true, value: null })
    expect(normalizeDisplayTitle(undefined)).toEqual({ ok: true, value: null })
  })

  it('trims valid titles', () => {
    expect(normalizeDisplayTitle('  工作 GitHub  ')).toEqual({ ok: true, value: '工作 GitHub' })
  })

  it('rejects titles over the max length without truncating', () => {
    const tooLong = 'x'.repeat(DISPLAY_TITLE_MAX_LENGTH + 1)
    expect(normalizeDisplayTitle(tooLong)).toEqual({ ok: false, error: 'too_long' })
    expect(normalizeDisplayTitle('y'.repeat(DISPLAY_TITLE_MAX_LENGTH))).toEqual({
      ok: true,
      value: 'y'.repeat(DISPLAY_TITLE_MAX_LENGTH),
    })
  })

  it('collapses a title that matches the default name', () => {
    expect(normalizeDisplayTitle('GitHub', 'GitHub')).toEqual({ ok: true, value: null })
    expect(normalizeDisplayTitle('  GitHub  ', 'GitHub')).toEqual({ ok: true, value: null })
    expect(normalizeDisplayTitle('工作 GitHub', 'GitHub')).toEqual({ ok: true, value: '工作 GitHub' })
  })
})

describe('display title overlay', () => {
  it('saves, reads, and restores a source title without changing the stable id', () => {
    createSource('github', 'GitHub')

    expect(setDisplayTitle(workspaceRoot, 'sources', 'github', '工作 GitHub')).toBe('工作 GitHub')
    expect(getDisplayTitle(workspaceRoot, 'sources', 'github')).toBe('工作 GitHub')

    const loaded = loadSource(workspaceRoot, 'github')
    expect(loaded?.config.slug).toBe('github')
    expect(loaded?.config.name).toBe('GitHub')
    expect(loaded?.displayTitle).toBe('工作 GitHub')
    expect(resolveSourceTitle(loaded!)).toBe('工作 GitHub')

    const persisted = JSON.parse(readFileSync(join(workspaceRoot, DISPLAY_TITLES_FILE), 'utf-8'))
    expect(persisted.sources.github).toBe('工作 GitHub')

    expect(setDisplayTitle(workspaceRoot, 'sources', 'github', '   ')).toBeNull()
    const restored = loadSource(workspaceRoot, 'github')
    expect(restored?.displayTitle).toBeUndefined()
    expect(restored?.config.name).toBe('GitHub')
    expect(restored?.config.slug).toBe('github')
    expect(resolveSourceTitle(restored!)).toBe('GitHub')
    expect(existsSync(join(workspaceRoot, DISPLAY_TITLES_FILE))).toBe(false)
  })

  it('saves, reads, and restores a skill title without changing slug or SKILL.md name', () => {
    createSkill('commit', 'Commit')

    expect(setDisplayTitle(workspaceRoot, 'skills', 'commit', '提交助手')).toBe('提交助手')

    const loaded = loadSkillBySlug(workspaceRoot, 'commit')
    expect(loaded?.slug).toBe('commit')
    expect(loaded?.metadata.name).toBe('Commit')
    expect(loaded?.displayTitle).toBe('提交助手')
    expect(resolveSkillTitle(loaded!)).toBe('提交助手')

    const fromAll = loadAllSkills(workspaceRoot).find((skill) => skill.slug === 'commit')
    expect(fromAll?.metadata.name).toBe('Commit')
    expect(fromAll?.displayTitle).toBe('提交助手')

    const skillMd = readFileSync(join(workspaceRoot, 'skills', 'commit', 'SKILL.md'), 'utf-8')
    expect(skillMd).toContain('name: "Commit"')
    expect(skillMd).not.toContain('提交助手')

    clearDisplayTitle(workspaceRoot, 'skills', 'commit')
    const restored = loadSkillBySlug(workspaceRoot, 'commit')
    expect(restored?.displayTitle).toBeUndefined()
    expect(restored?.slug).toBe('commit')
    expect(restored?.metadata.name).toBe('Commit')
    expect(resolveSkillTitle(restored!)).toBe('Commit')
  })

  it('allows duplicate display titles', () => {
    createSource('alpha', 'Alpha')
    createSource('beta', 'Beta')
    setDisplayTitle(workspaceRoot, 'sources', 'alpha', 'Shared')
    setDisplayTitle(workspaceRoot, 'sources', 'beta', 'Shared')
    expect(getDisplayTitle(workspaceRoot, 'sources', 'alpha')).toBe('Shared')
    expect(getDisplayTitle(workspaceRoot, 'sources', 'beta')).toBe('Shared')
  })

  it('does not persist a title that matches the default name', () => {
    createSource('github', 'GitHub')
    expect(setDisplayTitle(workspaceRoot, 'sources', 'github', 'GitHub', 'GitHub')).toBeNull()
    expect(getDisplayTitle(workspaceRoot, 'sources', 'github')).toBeUndefined()
    expect(existsSync(join(workspaceRoot, DISPLAY_TITLES_FILE))).toBe(false)
  })

  it('rejects empty ids', () => {
    expect(() => setDisplayTitle(workspaceRoot, 'sources', '  ', '工作 GitHub')).toThrow('Display title id is required')
  })

  it('rejects oversized titles and leaves the overlay unchanged', () => {
    createSource('github', 'GitHub')
    expect(() => {
      setDisplayTitle(workspaceRoot, 'sources', 'github', 'z'.repeat(DISPLAY_TITLE_MAX_LENGTH + 1))
    }).toThrow(DisplayTitleValidationError)
    expect(getDisplayTitle(workspaceRoot, 'sources', 'github')).toBeUndefined()
    expect(existsSync(join(workspaceRoot, DISPLAY_TITLES_FILE))).toBe(false)
  })

  it('clears overlay entries when the source or skill is deleted', () => {
    createSource('github', 'GitHub')
    createSkill('commit', 'Commit')
    setDisplayTitle(workspaceRoot, 'sources', 'github', '工作 GitHub')
    setDisplayTitle(workspaceRoot, 'skills', 'commit', '提交助手')

    deleteSource(workspaceRoot, 'github')
    deleteSkill(workspaceRoot, 'commit')

    const overlay = loadDisplayTitles(workspaceRoot)
    expect(overlay.sources.github).toBeUndefined()
    expect(overlay.skills.commit).toBeUndefined()
  })

  it('ignores invalid overlay values on load', () => {
    writeFileSync(
      join(workspaceRoot, DISPLAY_TITLES_FILE),
      JSON.stringify({
        sources: { github: '  ', other: 12, ok: '工作 GitHub' },
        skills: { commit: 'x'.repeat(DISPLAY_TITLE_MAX_LENGTH + 1), fine: '提交助手' },
      }),
    )
    const overlay = loadDisplayTitles(workspaceRoot)
    expect(overlay.sources).toEqual({ ok: '工作 GitHub' })
    expect(overlay.skills).toEqual({ fine: '提交助手' })
  })
})

describe('formatSourceRef', () => {
  it('leads with the original name when there is no alias', () => {
    expect(formatSourceRef({ config: { name: 'Cortex', slug: 'cortex' } })).toBe('Cortex (slug: cortex)')
  })

  it('leads with the display title and keeps the slug labeled', () => {
    expect(formatSourceRef({
      displayTitle: '知识库',
      config: { name: 'Cortex', slug: 'cortex' },
    })).toBe('知识库 (slug: cortex)')
    expect(formatSourceRef({
      displayTitle: '知识库',
      config: { name: 'Cortex', slug: 'cortex' },
    }, 'inactive')).toBe('知识库 (slug: cortex, inactive)')
  })
})

describe('matchesTitleSearch', () => {
  it('matches display title, original name, or slug', () => {
    expect(matchesTitleSearch('工作', '工作 GitHub', 'GitHub', 'github')).toBe(true)
    expect(matchesTitleSearch('git', '工作 GitHub', 'GitHub', 'github')).toBe(true)
    expect(matchesTitleSearch('hub', '工作 GitHub', 'GitHub', 'github')).toBe(true)
    expect(matchesTitleSearch('zzz', '工作 GitHub', 'GitHub', 'github')).toBe(false)
    expect(matchesTitleSearch('  ', '工作 GitHub', 'GitHub', 'github')).toBe(true)
  })
})
