import { describe, expect, test } from 'bun:test'
import {
  asciiContainingDir,
  generatedFileBaseDir,
  generatedFileBaseDirs,
  joinBaseAndRel,
  listGeneratedFilePathCandidates,
  normalizeGeneratedFilePath,
  pathsLikelySame,
  resolveGeneratedFilePath,
  resolveOpenableGeneratedPath,
  type GeneratedFileSearchHit,
} from '../generated-file-path.ts'

describe('normalizeGeneratedFilePath', () => {
  test('decodes percent-encoded Chinese segments', () => {
    expect(normalizeGeneratedFilePath('skills/%E5%B7%A1%E5%AF%9F%E5%B7%A5%E4%BD%9C.md'))
      .toBe('skills/巡察工作.md')
  })

  test('strips file:/// and leading slash before a Windows drive', () => {
    expect(normalizeGeneratedFilePath('file:///D:/selection/巡察工作/a.md'))
      .toBe('D:/selection/巡察工作/a.md')
    expect(normalizeGeneratedFilePath('/D:/selection/a.md'))
      .toBe('D:/selection/a.md')
  })

  test('preserves the POSIX root of a file URL', () => {
    expect(normalizeGeneratedFilePath('file:///Users/chenai/.selection/skills/lieflat-charts'))
      .toBe('/Users/chenai/.selection/skills/lieflat-charts')
    expect(normalizeGeneratedFilePath('file://localhost/Users/chenai/.selection/skills/lieflat-charts'))
      .toBe('/Users/chenai/.selection/skills/lieflat-charts')
  })

  test('keeps UNC shares and trims directory-link trailing separators', () => {
    expect(normalizeGeneratedFilePath('file://server/share/skills/'))
      .toBe('//server/share/skills')
    expect(normalizeGeneratedFilePath('file:///Users/me/skills/'))
      .toBe('/Users/me/skills')
    expect(normalizeGeneratedFilePath('file:///D:/skills/'))
      .toBe('D:/skills')
  })

  test('converts a Git Bash /c path to a Windows drive path', () => {
    expect(normalizeGeneratedFilePath(
      '/c/Users/fairy/.selection/sessions/报告 (1)_批注.docx',
      true,
    )).toBe('C:/Users/fairy/.selection/sessions/报告 (1)_批注.docx')
  })

  test('preserves a POSIX /c path outside Windows', () => {
    expect(normalizeGeneratedFilePath('/c/project/report.docx', false))
      .toBe('/c/project/report.docx')
  })
})

describe('generatedFileBaseDir', () => {
  test('uses the current session folder when no working directory was selected', () => {
    expect(generatedFileBaseDir({
      sessionFolderPath: 'C:\\Users\\fairy\\.selection\\sessions\\current',
      workspaceRootPath: 'C:\\Users\\fairy\\.selection',
    })).toBe('C:\\Users\\fairy\\.selection\\sessions\\current')
  })

  test('keeps an explicit working directory ahead of the session folder', () => {
    expect(generatedFileBaseDir({
      workingDirectory: 'D:\\测试',
      sessionFolderPath: 'C:\\Users\\fairy\\.selection\\sessions\\current',
      workspaceRootPath: 'C:\\Users\\fairy\\.selection',
    })).toBe('D:\\测试')
  })
})

test('keeps distinct working, session, and workspace roots in that order', () => {
  expect(generatedFileBaseDirs({
    workingDirectory: '/project',
    sessionFolderPath: '/workspace/sessions/one',
    workspaceRootPath: '/workspace',
  })).toEqual(['/project', '/workspace/sessions/one', '/workspace'])
})

describe('resolveGeneratedFilePath', () => {
  test('does not re-prefix a Windows absolute path', () => {
    expect(resolveGeneratedFilePath(
      'D:\\selection\\巡察工作\\skills\\SKILL.md',
      'D:\\selection\\巡察工作',
    )).toBe('D:\\selection\\巡察工作\\skills\\SKILL.md')
  })

  test('joins a Chinese relative path onto a Windows workspace root', () => {
    expect(resolveGeneratedFilePath(
      'skills/inspection-workflow/SKILL.md',
      'D:\\selection\\巡察工作',
    )).toBe('D:\\selection\\巡察工作\\skills\\inspection-workflow\\SKILL.md')
  })

  test('keeps a same-named inner folder as the primary candidate', () => {
    expect(resolveGeneratedFilePath(
      'skills/foo.md',
      'D:\\code\\skills',
    )).toBe('D:\\code\\skills\\skills\\foo.md')
  })

  test('offers a de-duplicated workspace-folder candidate without dropping the primary', () => {
    expect(listGeneratedFilePathCandidates(
      '巡察工作/skills/SKILL.md',
      'D:\\selection\\巡察工作',
    )).toEqual([
      'D:\\selection\\巡察工作\\巡察工作\\skills\\SKILL.md',
      'D:\\selection\\巡察工作\\skills\\SKILL.md',
    ])
  })

  test('joins a relative path onto a POSIX workspace root', () => {
    expect(resolveGeneratedFilePath(
      './docs/guide.md',
      '/Users/me/project',
    )).toBe('/Users/me/project/docs/guide.md')
  })
})

describe('joinBaseAndRel / pathsLikelySame', () => {
  test('compares mixed separators', () => {
    expect(pathsLikelySame(
      'D:\\selection\\巡察工作\\a.md',
      'D:/selection/巡察工作/a.md',
    )).toBe(true)
  })

  test('joins without doubling separators', () => {
    expect(joinBaseAndRel('D:\\selection\\巡察工作\\', 'foo.md'))
      .toBe('D:\\selection\\巡察工作\\foo.md')
  })
})

describe('asciiContainingDir', () => {
  test('returns the ASCII parent of a Chinese workspace folder', () => {
    expect(asciiContainingDir('D:\\selection\\巡察工作')).toBe('D:\\selection')
  })

  test('does not search an entire Windows drive', () => {
    expect(asciiContainingDir('D:\\巡察工作')).toBeNull()
  })
})

describe('resolveOpenableGeneratedPath', () => {
  const workspace = 'D:\\selection\\巡察工作'
  const realPath = 'D:\\selection\\巡察工作\\skills\\SKILL.md'
  const doubledPath = 'D:\\selection\\巡察工作\\巡察工作\\skills\\SKILL.md'

  function hit(path: string, relativePath: string): GeneratedFileSearchHit {
    return { type: 'file', name: 'SKILL.md', path, relativePath }
  }

  test('checks a hidden, deep directory directly without relying on capped search', async () => {
    const target = '/Users/me/.selection/workspaces/ws/skills/deep/lieflat-charts'
    const checked: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: `${target}/`,
      baseDir: '/Users/me/.selection/workspaces/ws',
      statPath: async (path) => {
        checked.push(path)
        return { path: target, type: 'directory' }
      },
      searchFiles: async () => { throw new Error('ranked search must not run') },
    })
    expect(checked).toEqual([target])
    expect(pick).toEqual({ path: target, type: 'directory' })
  })

  test('tries the workspace root when a relative skill link is absent from the session folder', async () => {
    const session = '/Users/me/.selection/workspaces/ws/sessions/one'
    const root = '/Users/me/.selection/workspaces/ws'
    const target = `${root}/skills/lieflat-charts`
    const checked: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: 'skills/lieflat-charts',
      baseDir: session,
      baseDirs: [session, root],
      statPath: async (path) => {
        checked.push(path)
        return path === target ? { path, type: 'directory' } : null
      },
      searchFiles: async () => { throw new Error('ranked search must not run') },
    })
    expect(checked).toEqual([`${session}/skills/lieflat-charts`, target])
    expect(pick).toEqual({ path: target, type: 'directory' })
  })

  test('checks the original Windows drive for a Chinese directory link', async () => {
    const target = 'D:\\巡察工作\\skills\\数据图表'
    const checked: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: 'file:///D:/巡察工作/skills/数据图表/',
      baseDir: 'C:\\Users\\fairy\\.selection',
      statPath: async (path) => {
        checked.push(path)
        return { path: target, type: 'directory' }
      },
      searchFiles: async () => [{
        type: 'directory', name: '数据图表', path: 'C:\\Users\\fairy\\.selection\\数据图表',
      }],
    })
    expect(checked).toEqual(['D:/巡察工作/skills/数据图表'])
    expect(pick).toEqual({ path: target, type: 'directory' })
  })

  test('does not search or redirect after exact stat denies access', async () => {
    await expect(resolveOpenableGeneratedPath({
      requestedPath: '/private/other/report.md',
      statPath: async () => { throw new Error('Access denied') },
      searchFiles: async () => [{ type: 'file', name: 'report.md', path: '/workspace/report.md' }],
    })).rejects.toThrow('Access denied')
  })

  test('uses the exact-search compatibility path only for an older server', async () => {
    const target = '/workspace/skills/lieflat-charts'
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: 'skills/lieflat-charts',
      baseDir: '/workspace',
      statPath: async () => {
        throw Object.assign(new Error('No handler for: fs:statPath'), { code: 'CHANNEL_NOT_FOUND' })
      },
      searchFiles: async () => [{ type: 'directory', name: 'lieflat-charts', path: target }],
    })
    expect(pick).toEqual({ path: target, type: 'directory' })
  })

  test('resolves an installed skill directory linked with file://', async () => {
    const directory = '/Users/chenai/.selection/workspaces/my-workspace/skills/lieflat-charts'
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: `file://${directory}`,
      baseDir: '/Users/chenai/.selection/workspaces/my-workspace',
      searchFiles: async (parent, query) => {
        seen.push(`${parent}::${query}`)
        return [{ type: 'directory', name: 'lieflat-charts', path: directory }]
      },
    })
    expect(seen).toEqual([
      '/Users/chenai/.selection/workspaces/my-workspace/skills::lieflat-charts',
    ])
    expect(pick).toEqual({ path: directory, type: 'directory' })
  })

  test('does not substitute a directory with the same name in another folder', async () => {
    await expect(resolveOpenableGeneratedPath({
      requestedPath: 'skills/lieflat-charts',
      baseDir: '/workspace',
      searchFiles: async () => [{
        type: 'directory',
        name: 'lieflat-charts',
        path: '/workspace/other/lieflat-charts',
      }],
    })).rejects.toThrow('File not found')
  })

  test('prefers the existing de-duplicated candidate when the doubled parent is missing', async () => {
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: '巡察工作/skills/SKILL.md',
      baseDir: workspace,
      searchFiles: async (dir) => {
        if (dir === `${workspace}\\巡察工作\\skills`) {
          throw new Error('temp dir missing')
        }
        if (dir === `${workspace}\\skills`) {
          return [hit(realPath, 'skills/SKILL.md')]
        }
        return []
      },
    })
    expect(pick).toEqual({ path: realPath, type: 'file' })
  })

  test('opens a bare generated filename directly from the session folder', async () => {
    const sessionFolder = 'C:\\Users\\fairy\\.selection\\sessions\\current'
    const generated = `${sessionFolder}\\云南华电2025年度光伏EPC总承包框架招标文件_法律审查汇总.xlsx`
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: '云南华电2025年度光伏EPC总承包框架招标文件_法律审查汇总.xlsx',
      baseDir: sessionFolder,
      searchFiles: async (dir, query) => {
        seen.push(`${dir}::${query}`)
        return [{
          type: 'file',
          name: query,
          path: generated,
          relativePath: query,
        }]
      },
    })
    expect(seen).toEqual([`${sessionFolder}::云南华电2025年度光伏EPC总承包框架招标文件_法律审查汇总.xlsx`])
    expect(pick).toEqual({ path: generated, type: 'file' })
  })

  test('probes a Git Bash absolute path as its real Windows path', async () => {
    const generated = 'C:/Users/fairy/.selection/sessions/current/报告 (1)_批注.docx'
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: '/c/Users/fairy/.selection/sessions/current/报告 (1)_批注.docx',
      baseDir: 'C:\\Users\\fairy\\.selection',
      searchFiles: async (dir, query) => {
        seen.push(`${dir}::${query}`)
        return [{
          type: 'file',
          name: query,
          path: generated,
          relativePath: 'sessions/current/报告 (1)_批注.docx',
        }]
      },
    })
    expect(seen).toEqual(['C:/Users/fairy/.selection/sessions/current::报告 (1)_批注.docx'])
    expect(pick).toEqual({ path: generated, type: 'file' })
  })

  test('falls back to a workspace-root search instead of opening the doubled path', async () => {
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: '巡察工作/skills/SKILL.md',
      baseDir: workspace,
      searchFiles: async (dir, query) => {
        if (dir === workspace && query === 'SKILL.md') {
          return [hit(realPath, 'skills/SKILL.md')]
        }
        return []
      },
    })
    expect(pick.path).toBe(realPath)
    expect(pick.path).not.toBe(doubledPath)
  })

  test('does not guess among several same-named files', async () => {
    await expect(resolveOpenableGeneratedPath({
      requestedPath: 'SKILL.md',
      baseDir: workspace,
      searchFiles: async () => [
        hit(`${workspace}\\skills\\a\\SKILL.md`, 'skills/a/SKILL.md'),
        hit(`${workspace}\\skills\\b\\SKILL.md`, 'skills/b/SKILL.md'),
      ],
    })).rejects.toThrow('File not found')
  })

  test('does not replace a missing target with a unique same-named file elsewhere', async () => {
    await expect(resolveOpenableGeneratedPath({
      requestedPath: 'missing-folder/SKILL.md',
      baseDir: workspace,
      searchFiles: async (dir) => {
        if (dir === workspace) {
          return [hit(realPath, 'skills/SKILL.md')]
        }
        return []
      },
    })).rejects.toThrow('File not found')
  })

  test('never redirects a missing D: artifact to a same-named file on C:', async () => {
    const fileName = 'enterprise-data-platform-flow.html'
    await expect(resolveOpenableGeneratedPath({
      requestedPath: `file:///D:/成果/${fileName}`,
      baseDir: 'C:\\Users\\fairy\\.selection',
      searchFiles: async (dir) => dir.startsWith('C:')
        ? [{ type: 'file', name: fileName, path: `C:\\Users\\fairy\\.selection\\${fileName}` }]
        : [],
    })).rejects.toThrow('File not found')
  })

  test('resolves a D: artifact from the session working directory despite a C: duplicate', async () => {
    const fileName = 'enterprise-data-platform-flow.html'
    const realPath = `D:\\成果\\${fileName}`
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: fileName,
      baseDir: 'D:\\成果',
      searchFiles: async (dir) => dir === 'D:\\成果'
        ? [
            { type: 'file', name: fileName, path: `C:\\成果\\${fileName}` },
            { type: 'file', name: fileName, path: realPath },
          ]
        : [],
    })
    expect(pick).toEqual({ path: realPath, type: 'file' })
  })

  test('does not treat a POSIX case-variant as the same suffix', async () => {
    await expect(resolveOpenableGeneratedPath({
      requestedPath: 'docs/SKILL.md',
      baseDir: '/Users/me/proj',
      searchFiles: async () => [
        { type: 'file', name: 'skill.md', path: '/Users/me/proj/other/skill.md', relativePath: 'other/skill.md' },
        { type: 'file', name: 'skill.md', path: '/Users/me/proj/docs/skill.md', relativePath: 'docs/skill.md' },
      ],
    })).rejects.toThrow('File not found')
  })

  test('probes the unix root when the file lives at /name', async () => {
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: '/a.md',
      searchFiles: async (dir, query) => {
        seen.push(`${dir}::${query}`)
        if (dir === '/' && query === 'a.md') {
          return [{ type: 'file', name: 'a.md', path: '/a.md', relativePath: 'a.md' }]
        }
        return []
      },
    })
    expect(seen).toContain('/::a.md')
    expect(pick.path).toBe('/a.md')
  })

  test('searches the ASCII ancestor when the Chinese workspace root search throws', async () => {
    const pick = await resolveOpenableGeneratedPath({
      requestedPath: 'skills/SKILL.md',
      baseDir: workspace,
      searchFiles: async (dir) => {
        if (dir === workspace) throw new Error('ENOENT')
        if (dir === 'D:\\selection') {
          return [hit(realPath, '巡察工作/skills/SKILL.md')]
        }
        return []
      },
    })
    expect(pick.path).toBe(realPath)
  })
})

test('rejects missing files instead of returning an invented path', async () => {
  await expect(resolveOpenableGeneratedPath({requestedPath:'AGENTS.md',baseDir:'/workspace',searchFiles:async()=>[]})).rejects.toThrow('File not found')
})
test('does not open a fuzzy search result with a different filename', async () => {
  await expect(resolveOpenableGeneratedPath({requestedPath:'AGENTS.md',baseDir:'/workspace',searchFiles:async()=>[{type:'file',name:'AGENTS-backup.md',path:'/workspace/AGENTS-backup.md',relativePath:'AGENTS-backup.md'}]})).rejects.toThrow('File not found')
})
