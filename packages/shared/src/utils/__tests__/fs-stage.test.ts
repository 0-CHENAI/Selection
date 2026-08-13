import { describe, expect, test, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  stagedDirectoryReplace,
  finalizeStagedDirectory,
  safeTempNameSegment,
  winLongPath,
  copyDirRecursive,
} from '../fs-stage.ts'

const temps: string[] = []

function mk(): string {
  const d = join(tmpdir(), `fs-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(d, { recursive: true })
  temps.push(d)
  return d
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('safeTempNameSegment', () => {
  test('strips non-ascii and path-hostile chars', () => {
    expect(safeTempNameSegment('inspection-workflow')).toBe('inspection-workflow')
    expect(safeTempNameSegment('巡察-workflow')).toMatch(/^[a-zA-Z0-9._-]+$/)
    expect(safeTempNameSegment('a/b\\c:d')).not.toContain('/')
    expect(safeTempNameSegment('a/b\\c:d')).not.toContain(':')
  })
})

describe('winLongPath', () => {
  test('is no-op on non-windows', () => {
    if (process.platform === 'win32') return
    expect(winLongPath('/tmp/foo')).toBe('/tmp/foo')
  })
})

describe('copyDirRecursive', () => {
  test('copies nested tree with UTF-8 files', () => {
    const root = mk()
    const from = join(root, 'from')
    const to = join(root, 'to')
    mkdirSync(join(from, 'nested'), { recursive: true })
    writeFileSync(join(from, 'SKILL.md'), '技能内容', 'utf-8')
    writeFileSync(join(from, 'nested', 'a.txt'), 'nested', 'utf-8')

    copyDirRecursive(from, to)
    expect(readFileSync(join(to, 'SKILL.md'), 'utf-8')).toBe('技能内容')
    expect(readFileSync(join(to, 'nested', 'a.txt'), 'utf-8')).toBe('nested')
  })
})

describe('stagedDirectoryReplace', () => {
  test('copies into Chinese parent path preserving UTF-8 content', () => {
    const root = mk()
    const from = join(root, 'from', 'skill')
    const toParent = join(root, '巡察工作', 'skills')
    const to = join(toParent, 'inspection-workflow')
    mkdirSync(from, { recursive: true })
    writeFileSync(join(from, 'SKILL.md'), '---\nname: 巡察技能\ndescription: 描述\n---\n正文\n', 'utf-8')

    stagedDirectoryReplace(from, to)

    expect(existsSync(join(to, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(to, 'SKILL.md'), 'utf-8')).toContain('巡察技能')
    // no leftover temp dirs under parent
    const leftovers = readdirSync(toParent).filter(
      (n) => n.startsWith('.tmp-copy-') || n.startsWith('.tmp-') || n.startsWith('selection-stage-'),
    )
    expect(leftovers).toEqual([])
  })

  test('overwrites existing destination', () => {
    const root = mk()
    const from = join(root, 'from')
    const to = join(root, 'to', 'skill')
    mkdirSync(from, { recursive: true })
    mkdirSync(to, { recursive: true })
    writeFileSync(join(from, 'SKILL.md'), 'new-content', 'utf-8')
    writeFileSync(join(to, 'SKILL.md'), 'old-content', 'utf-8')

    stagedDirectoryReplace(from, to)
    expect(readFileSync(join(to, 'SKILL.md'), 'utf-8')).toBe('new-content')
  })

  test('throws when source missing', () => {
    const root = mk()
    expect(() => stagedDirectoryReplace(join(root, 'nope'), join(root, 'out'))).toThrow(/does not exist/)
  })
})

describe('finalizeStagedDirectory', () => {
  test('moves staged dir into place under Chinese parent', () => {
    const root = mk()
    const parent = join(root, '目标工作区', 'skills')
    const tmp = join(parent, '.tmp-res-abcd1234')
    const to = join(parent, 'my-skill')
    mkdirSync(tmp, { recursive: true })
    writeFileSync(join(tmp, 'SKILL.md'), 'staged', 'utf-8')

    finalizeStagedDirectory(tmp, to)
    expect(existsSync(join(to, 'SKILL.md'))).toBe(true)
    expect(existsSync(tmp)).toBe(false)
  })
})
