import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { normalizePathForComparison, resolveFsPath } from '@craft-agent/shared/utils'
import {
  FILE_ACCESS_MISSING_WORKSPACE_MESSAGE,
  FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE,
  getWorkspaceAllowedDirs,
  listLocalFolderPaths,
  listProjectWorkingDirectories,
  listSessionWorkingDirectories,
  normalizeAccessibleFilePath,
  resolveWorkspaceIdForFileAccess,
  validateFilePath,
  validateWorkspaceFilePath,
  type WorkspaceAllowlistSources,
} from '../utils'

const offHomeDir = sep === '\\' ? 'D:\\文档 项目' : '/Volumes/D/文档 项目'
const localFolder = sep === '\\' ? 'D:\\本地 文件夹' : '/Volumes/D/本地 文件夹'
const projectDir = sep === '\\' ? 'E:\\proj extra' : '/Volumes/E/proj extra'
const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function sources(overrides: Partial<WorkspaceAllowlistSources> = {}): WorkspaceAllowlistSources {
  return {
    getWorkspace: () => ({ rootPath: '/tmp/selection-ws' }),
    getDefaultWorkingDirectory: () => undefined,
    getProjectWorkingDirectories: () => [],
    getLocalFolderPaths: () => [],
    getSessionWorkingDirectories: () => [],
    ...overrides,
  }
}

describe('getWorkspaceAllowedDirs', () => {
  it('returns an empty list when workspace context is missing or unknown', () => {
    expect(getWorkspaceAllowedDirs(null, sources())).toEqual([])
    expect(getWorkspaceAllowedDirs('ws-1', sources({ getWorkspace: () => null }))).toEqual([])
  })

  it('includes workspace root, default cwd, projects, Local Folders, and session working directories', () => {
    const dirs = getWorkspaceAllowedDirs('ws-1', sources({
      getDefaultWorkingDirectory: () => offHomeDir,
      getProjectWorkingDirectories: () => [projectDir],
      getLocalFolderPaths: () => [localFolder],
      getSessionWorkingDirectories: () => [join(offHomeDir, 'nested')],
    }))

    const keys = dirs.map(dir => normalizePathForComparison(dir))
    expect(keys).toContain(normalizePathForComparison(resolveFsPath('/tmp/selection-ws')))
    expect(keys).toContain(normalizePathForComparison(resolveFsPath(offHomeDir)))
    expect(keys).toContain(normalizePathForComparison(resolveFsPath(localFolder)))
    expect(keys).toContain(normalizePathForComparison(resolveFsPath(projectDir)))
    expect(keys).toContain(normalizePathForComparison(resolveFsPath(join(offHomeDir, 'nested'))))
  })

  it('deduplicates equivalent paths', () => {
    const dirs = getWorkspaceAllowedDirs('ws-1', sources({
      getDefaultWorkingDirectory: () => '/tmp/selection-ws',
      getSessionWorkingDirectories: () => ['/tmp/selection-ws'],
    }))

    expect(dirs).toHaveLength(1)
  })

  it('allows a D-drive Chinese path when that session working directory is authorized', async () => {
    const dirs = getWorkspaceAllowedDirs('ws-1', sources({
      getSessionWorkingDirectories: () => [offHomeDir],
    }))
    const result = await validateFilePath(join(offHomeDir, '报告.docx'), dirs)
    expect(result).toContain('报告.docx')
  })

  it('reads working directories from disk without creating workspace folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-allowlist-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'sessions', 'sess-1'), { recursive: true })
    writeFileSync(join(root, 'sessions', 'sess-1', 'session.jsonl'), `${JSON.stringify({
      id: 'sess-1',
      workingDirectory: offHomeDir,
    })}\n`)
    mkdirSync(join(root, 'projects', 'proj-1'), { recursive: true })
    writeFileSync(join(root, 'projects', 'proj-1', 'config.json'), JSON.stringify({
      slug: 'proj-1',
      workingDirectory: projectDir,
    }))
    mkdirSync(join(root, 'sources', 'local-docs'), { recursive: true })
    writeFileSync(join(root, 'sources', 'local-docs', 'config.json'), JSON.stringify({
      type: 'local',
      local: { path: localFolder },
    }))

    const emptyRoot = mkdtempSync(join(tmpdir(), 'selection-allowlist-empty-'))
    tempRoots.push(emptyRoot)

    expect(listSessionWorkingDirectories(root).map(dir => normalizePathForComparison(dir)))
      .toContain(normalizePathForComparison(resolveFsPath(offHomeDir)))
    expect(listProjectWorkingDirectories(root).map(dir => normalizePathForComparison(dir)))
      .toContain(normalizePathForComparison(resolveFsPath(projectDir)))
    expect(listLocalFolderPaths(root).map(dir => normalizePathForComparison(dir)))
      .toContain(normalizePathForComparison(resolveFsPath(localFolder)))
    expect(listSessionWorkingDirectories(emptyRoot)).toEqual([])
    expect(listProjectWorkingDirectories(emptyRoot)).toEqual([])
    expect(listLocalFolderPaths(emptyRoot)).toEqual([])
    expect(existsSync(join(emptyRoot, 'sessions'))).toBe(false)
    expect(existsSync(join(emptyRoot, 'projects'))).toBe(false)
    expect(existsSync(join(emptyRoot, 'sources'))).toBe(false)
  })
})

describe('resolveWorkspaceIdForFileAccess', () => {
  it('prefers an explicit workspaceId', () => {
    expect(resolveWorkspaceIdForFileAccess(
      { workspaceId: 'ws-1', webContentsId: 9 },
      { getWorkspaceForWindow: () => 'ws-window' },
    )).toBe('ws-1')
  })

  it('falls back to the window mapping when workspaceId is missing', () => {
    expect(resolveWorkspaceIdForFileAccess(
      { workspaceId: null, webContentsId: 9 },
      { getWorkspaceForWindow: id => (id === 9 ? 'ws-window' : null) },
    )).toBe('ws-window')
  })

  it('returns null when neither workspaceId nor a window mapping is available', () => {
    expect(resolveWorkspaceIdForFileAccess({ workspaceId: null, webContentsId: 9 })).toBeNull()
    expect(resolveWorkspaceIdForFileAccess({ workspaceId: '', webContentsId: null }, {
      getWorkspaceForWindow: () => 'ws-window',
    })).toBeNull()
  })
})

describe('validateWorkspaceFilePath', () => {
  it('allows a Chinese path with spaces when that directory is authorized', async () => {
    const filePath = join(offHomeDir, '报告.docx')
    const result = await validateFilePath(filePath, [offHomeDir])
    expect(result).toContain('报告.docx')
  })

  it('keeps denying paths that are not home, tmp, or an authorized folder', async () => {
    const forbidden = sep === '\\' ? 'Z:\\forbidden\\secret.docx' : '/forbidden/secret.docx'
    await expect(validateFilePath(forbidden)).rejects.toThrow(FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE)
  })

  it('explains a missing workspace when the path is outside home and tmp', async () => {
    const forbidden = sep === '\\' ? 'Z:\\forbidden\\secret.docx' : '/forbidden/secret.docx'
    await expect(validateWorkspaceFilePath(forbidden, null)).rejects.toThrow(FILE_ACCESS_MISSING_WORKSPACE_MESSAGE)
  })

  it('normalizes file:// and /D: Windows links before validation', () => {
    expect(normalizeAccessibleFilePath('file:///D:/selection/巡察工作/a.docx'))
      .toBe('D:/selection/巡察工作/a.docx')
    expect(normalizeAccessibleFilePath('/D:/selection/a.docx'))
      .toBe('D:/selection/a.docx')
    expect(normalizeAccessibleFilePath('file://localhost/C:/Users/me/a.docx'))
      .toBe('C:/Users/me/a.docx')
  })
})
