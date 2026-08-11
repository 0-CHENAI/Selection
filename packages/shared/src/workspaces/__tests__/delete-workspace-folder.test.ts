import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteWorkspaceFolderDetailed,
  isSafeToDeleteWorkspaceFolder,
} from '../storage.ts'
import { CONFIG_DIR } from '../../config/paths.ts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ws-delete-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('isSafeToDeleteWorkspaceFolder', () => {
  test('rejects empty path', () => {
    expect(isSafeToDeleteWorkspaceFolder('').ok).toBe(false)
    expect(isSafeToDeleteWorkspaceFolder('   ').ok).toBe(false)
  })

  test('rejects home and config roots', () => {
    expect(isSafeToDeleteWorkspaceFolder(CONFIG_DIR).ok).toBe(false)
    expect(isSafeToDeleteWorkspaceFolder(join(CONFIG_DIR, 'workspaces')).ok).toBe(false)
  })

  test('allows managed workspace children under default workspaces dir', () => {
    const managed = join(CONFIG_DIR, 'workspaces', `test-ws-${Date.now()}`)
    // Path need not exist for managed-child check
    expect(isSafeToDeleteWorkspaceFolder(managed).ok).toBe(true)
  })

  test('allows custom path only when config.json present', () => {
    const custom = makeTempDir()
    expect(isSafeToDeleteWorkspaceFolder(custom).ok).toBe(false)

    writeFileSync(join(custom, 'config.json'), JSON.stringify({ id: 'ws_x', name: 'x' }))
    expect(isSafeToDeleteWorkspaceFolder(custom).ok).toBe(true)
  })
})

describe('deleteWorkspaceFolderDetailed', () => {
  test('reports alreadyGone when path missing', () => {
    const result = deleteWorkspaceFolderDetailed(join(makeTempDir(), 'does-not-exist'))
    expect(result.deleted).toBe(true)
    expect(result.alreadyGone).toBe(true)
  })

  test('deletes a valid custom workspace folder', () => {
    const custom = makeTempDir()
    writeFileSync(join(custom, 'config.json'), JSON.stringify({ id: 'ws_x', name: 'x' }))
    mkdirSync(join(custom, 'sessions'), { recursive: true })
    writeFileSync(join(custom, 'sessions', 'a.json'), '{}')

    const result = deleteWorkspaceFolderDetailed(custom)
    expect(result.deleted).toBe(true)
    expect(existsSync(custom)).toBe(false)
  })

  test('refuses unsafe paths without deleting', () => {
    const result = deleteWorkspaceFolderDetailed(CONFIG_DIR)
    expect(result.deleted).toBe(false)
    expect(result.error).toMatch(/Refusing|config/i)
    expect(existsSync(CONFIG_DIR)).toBe(true)
  })
})
