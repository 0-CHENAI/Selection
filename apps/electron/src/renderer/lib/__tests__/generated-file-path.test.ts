import { describe, expect, test } from 'bun:test'
import {
  asciiContainingDir,
  generatedFileBaseDir,
  joinBaseAndRel,
  listGeneratedFilePathCandidates,
  normalizeGeneratedFilePath,
  pathsLikelySame,
  resolveGeneratedFilePath,
  resolveOpenableGeneratedFile,
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

describe('resolveOpenableGeneratedFile', () => {
  const workspace = 'D:\\selection\\巡察工作'
  const realPath = 'D:\\selection\\巡察工作\\skills\\SKILL.md'
  const doubledPath = 'D:\\selection\\巡察工作\\巡察工作\\skills\\SKILL.md'

  function hit(path: string, relativePath: string): GeneratedFileSearchHit {
    return { type: 'file', name: 'SKILL.md', path, relativePath }
  }

  test('prefers the existing de-duplicated candidate when the doubled parent is missing', async () => {
    const pick = await resolveOpenableGeneratedFile({
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
    expect(pick).toEqual({ path: realPath })
  })

  test('opens a bare generated filename directly from the session folder', async () => {
    const sessionFolder = 'C:\\Users\\fairy\\.selection\\sessions\\current'
    const generated = `${sessionFolder}\\云南华电2025年度光伏EPC总承包框架招标文件_法律审查汇总.xlsx`
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedFile({
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
    expect(pick).toEqual({ path: generated })
  })

  test('probes a Git Bash absolute path as its real Windows path', async () => {
    const generated = 'C:/Users/fairy/.selection/sessions/current/报告 (1)_批注.docx'
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedFile({
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
    expect(pick).toEqual({ path: generated })
  })

  test('falls back to a workspace-root search instead of opening the doubled path', async () => {
    const pick = await resolveOpenableGeneratedFile({
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
    const pick = await resolveOpenableGeneratedFile({
      requestedPath: 'SKILL.md',
      baseDir: workspace,
      searchFiles: async () => [
        hit(`${workspace}\\skills\\a\\SKILL.md`, 'skills/a/SKILL.md'),
        hit(`${workspace}\\skills\\b\\SKILL.md`, 'skills/b/SKILL.md'),
      ],
    })
    expect(pick).toEqual({ path: `${workspace}\\SKILL.md` })
  })

  test('opens the unique workspace match when parent probes fail', async () => {
    const pick = await resolveOpenableGeneratedFile({
      requestedPath: 'missing-folder/SKILL.md',
      baseDir: workspace,
      searchFiles: async (dir) => {
        if (dir === workspace) {
          return [hit(realPath, 'skills/SKILL.md')]
        }
        return []
      },
    })
    expect(pick.path).toBe(realPath)
    expect(pick.closestMatchRelativePath).toBe('skills/SKILL.md')
  })

  test('does not treat a POSIX case-variant as the same suffix', async () => {
    const pick = await resolveOpenableGeneratedFile({
      requestedPath: 'docs/SKILL.md',
      baseDir: '/Users/me/proj',
      searchFiles: async () => [
        { type: 'file', name: 'skill.md', path: '/Users/me/proj/other/skill.md', relativePath: 'other/skill.md' },
        { type: 'file', name: 'skill.md', path: '/Users/me/proj/docs/skill.md', relativePath: 'docs/skill.md' },
      ],
    })
    expect(pick.path).toBe('/Users/me/proj/docs/SKILL.md')
    expect(pick.closestMatchRelativePath).toBeUndefined()
  })

  test('probes the unix root when the file lives at /name', async () => {
    const seen: string[] = []
    const pick = await resolveOpenableGeneratedFile({
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
    const pick = await resolveOpenableGeneratedFile({
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
