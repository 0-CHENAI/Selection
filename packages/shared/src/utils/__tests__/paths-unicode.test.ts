import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { isPathInside, resolveFsPath, toPortablePath, expandPath } from '../paths.ts'

describe('resolveFsPath / isPathInside (unicode)', () => {
  test('NFC-normalizes Chinese path segments', () => {
    const nfd = '中文'.normalize('NFD')
    const nfc = '中文'.normalize('NFC')
    const base = join(tmpdir(), 'paths-unicode')
    const a = resolveFsPath(join(base, nfd, 'ws'))
    const b = resolveFsPath(join(base, nfc, 'ws'))
    expect(a).toBe(b)
  })

  test('isPathInside handles Chinese parent/child', () => {
    const parent = join(tmpdir(), '父目录')
    const child = join(parent, '子', 'file.txt')
    expect(isPathInside(parent, child)).toBe(true)
    expect(isPathInside(parent, join(tmpdir(), '其他'))).toBe(false)
  })

  test('portable ~ round-trip keeps Chinese segments', () => {
    // Only meaningful when path is under home; construct via expandPath of a ~ form
    const portable = '~/文档/工作区'
    const abs = expandPath(portable)
    expect(abs.includes('文档')).toBe(true)
    expect(abs.includes('工作区')).toBe(true)
    const again = toPortablePath(abs)
    expect(again.startsWith('~/') || again.includes('文档')).toBe(true)
    expect(resolveFsPath(again)).toBe(resolveFsPath(abs))
  })
})
