import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '../../..')
const office = join(repoRoot, 'apps/electron/resources/skills/office-business')

function walk(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const caseRoots: Array<[string, string]> = [
  ['packages/dsh-desktop-office/sources/curated/meeting-minutes/', 'cases/meeting-minutes/'],
  ['packages/dsh-desktop-office/sources/legacy/coffee-market/', 'cases/coffee-market/'],
  ['packages/dsh-desktop-office/sources/legacy/equity-research/', 'cases/equity-research/'],
  ['packages/dsh-desktop-office/sources/legacy/government-notice/', 'cases/government-notice/'],
]

const verbatimSkills = [
  'packages/dsh-desktop-office/business-skills/meeting-recap/LICENSE',
  'packages/dsh-desktop-office/business-skills/work-report-writer/LICENSE',
  'packages/dsh-desktop-office/business-skills/research-writer/LICENSE.txt',
]

describe('stage 07 word assets', () => {
  test('copied case bytes and license files match the inventory', () => {
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'docs/plans/dsh-office-inventory.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>
    }
    const byPath = new Map(inventory.files.map(file => [file.path, file.sha256]))
    let checked = 0
    for (const file of inventory.files) {
      for (const [from, to] of caseRoots) {
        if (!file.path.startsWith(from)) continue
        const local = join(office, to, file.path.slice(from.length))
        expect(sha256(local)).toBe(file.sha256)
        checked += 1
      }
    }
    expect(checked).toBe(3 + 7 + 6 + 3)
    for (const path of verbatimSkills) {
      const name = path.split('/').slice(-2).join('/')
      const expected = byPath.get(path)
      if (!expected) throw new Error(`清单缺少 ${path}`)
      expect(sha256(join(office, 'business-skills', name))).toBe(expected)
    }
  })

  test('research-writer keeps the Apache text and only appends the delivery section', () => {
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'docs/plans/dsh-office-inventory.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>
    }
    const expected = inventory.files.find(file => file.path.endsWith('research-writer/SKILL.md'))?.sha256
    if (!expected) throw new Error('清单缺少 research-writer/SKILL.md')
    const text = readFileSync(join(office, 'business-skills/research-writer/SKILL.md'), 'utf8')
    const marker = '<!-- selection-delivery:start -->'
    const prefix = text.slice(0, text.indexOf(marker))
    expect(createHash('sha256').update(prefix).digest('hex')).toBe(expected)
    expect(text).toContain('Apache-2.0')
    expect(text).toContain('LICENSE.txt')
  })

  test('the package has four skills, no Python, and the gov skill is original', () => {
    const files = walk(office)
    expect(files.filter(file => file.endsWith('.py'))).toEqual([])
    for (const name of ['meeting-recap', 'work-report-writer', 'research-writer', 'gov-doc-writing']) {
      expect(readFileSync(join(office, 'business-skills', name, 'SKILL.md'), 'utf8').length).toBeGreaterThan(200)
    }
    const copiedSkills = ['meeting-recap/SKILL.md', 'work-report-writer/SKILL.md', 'research-writer/SKILL.md']
    for (const relative of copiedSkills) {
      const text = readFileSync(join(office, 'business-skills', relative), 'utf8')
      expect(text).toContain('officecli load_skill word')
      expect(text).not.toContain('load_workspace_dependencies')
      expect(text).not.toContain('validate_minutes.py')
      expect(text).not.toContain('官方 Kit')
    }
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'docs/plans/dsh-office-inventory.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>
    }
    const govHashes = new Set(
      inventory.files.filter(file => file.path.includes('/gov-doc-writing/')).map(file => file.sha256),
    )
    const govDir = join(office, 'business-skills/gov-doc-writing')
    const govText = walk(govDir).map(file => readFileSync(file, 'utf8')).join('\n')
    expect(govText).toContain('能力参照 dsh-desktop gov-doc-writing，未复用其内容')
    for (const file of walk(govDir)) expect(govHashes.has(sha256(file))).toBe(false)
    for (const needle of [
      '四步驱动器',
      '六维质检',
      '安全性一票否决',
      '配套素材库',
      '专家团',
      '01_主册_生成前准备',
      'WorkBuddy',
      '红线 S1',
      'v2.0.4',
    ]) {
      expect(govText).not.toContain(needle)
    }
  })

  test('catalog keeps dsh fields and Selection samples in their own category', () => {
    const catalog = JSON.parse(readFileSync(join(office, 'catalog.json'), 'utf8')) as {
      cases: Array<Record<string, unknown>>
    }
    const byId = new Map(catalog.cases.map(item => [item.id, item]))
    expect(byId.get('meeting-minutes')).toMatchObject({
      businessSkill: 'meeting-recap',
      revision: '20261012.1',
      mode: 'word',
      category: '会议纪要',
    })
    expect(byId.get('coffee-market')).not.toHaveProperty('prompt')
    expect(byId.get('government-notice')).toMatchObject({ businessSkill: 'gov-doc-writing' })
    expect(byId.get('selection-meeting-minutes')).toMatchObject({ category: 'Selection 样例' })
    expect(byId.get('selection-work-notice')).toMatchObject({ category: 'Selection 样例' })
    expect(byId.get('execution-tracker')).toMatchObject({ mode: 'excel' })
    const selection = byId.get('meeting-minutes')?.selection as { namespace?: string }
    expect(selection.namespace).toBe('selection.office.v1')
  })
})
