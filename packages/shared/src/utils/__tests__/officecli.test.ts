import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { OFFICECLI_DESKTOP_TARGETS, OFFICECLI_SHA256 } from '../../../../../scripts/build/common.ts'
import {
  BUNDLED_OFFICECLI_SKILL_SLUGS,
  collectOfficeFormatSkillSlugs,
  getBundledOfficecliSkillsDir,
  officecliBinaryName,
  resolveOfficecliBinary,
} from '../officecli'

describe('collectOfficeFormatSkillSlugs', () => {
  it('infers format skills from Office paths in the message', () => {
    expect(collectOfficeFormatSkillSlugs('请改 巡察报告.docx')).toEqual(['officecli-docx'])
    expect(collectOfficeFormatSkillSlugs('compare a.docx and b.xlsx')).toEqual([
      'officecli-xlsx',
      'officecli-docx',
    ])
    expect(collectOfficeFormatSkillSlugs('deck.pptx')).toEqual(['officecli-pptx'])
  })

  it('does not infer from a request that only talks about a report', () => {
    expect(collectOfficeFormatSkillSlugs('写一份巡察报告')).toEqual([])
  })

  it('infers from Office attachments, defaulting typeless office files to docx', () => {
    expect(collectOfficeFormatSkillSlugs('看一下', [
      { type: 'office', name: '数据.xlsx', path: '/tmp/数据.xlsx' },
    ])).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('看一下', [
      { type: 'office', name: '附件', storedPath: '/tmp/session/att-1' },
    ])).toEqual(['officecli-docx'])
  })
})

describe('resolveOfficecliBinary', () => {
  it('names the Windows executable with .exe', () => {
    expect(officecliBinaryName('win32')).toBe('officecli.exe')
    expect(officecliBinaryName('darwin')).toBe('officecli')
  })

  it('ships PATH wrappers for both Unix and Windows shells', () => {
    const binDir = join(process.cwd(), 'apps', 'electron', 'resources', 'bin')
    const sh = readFileSync(join(binDir, 'officecli'), 'utf8')
    const cmd = readFileSync(join(binDir, 'officecli.cmd'), 'utf8')
    expect(sh).toContain('CRAFT_OFFICECLI')
    expect(sh).toContain('win32-x64/officecli.exe')
    expect(cmd).toContain('CRAFT_OFFICECLI')
    expect(cmd).toContain('win32-x64\\officecli.exe')
  })

  it('fetches every supported desktop binary for installer builds', () => {
    expect(OFFICECLI_DESKTOP_TARGETS).toEqual([
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' },
    ])
    for (const target of OFFICECLI_DESKTOP_TARGETS) {
      expect(OFFICECLI_SHA256[`${target.platform}-${target.arch}`]).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('finds the bundled binary after fetch', () => {
    const binary = resolveOfficecliBinary()
    if (!binary) {
      console.warn('officecli binary not fetched; skip path assertion')
      return
    }
    expect(existsSync(binary)).toBe(true)
    expect(binary.endsWith(officecliBinaryName())).toBe(true)
  })
})

describe('bundled officecli smoke', () => {
  const binary = resolveOfficecliBinary()

  it('reports a version', () => {
    if (!binary) return
    const result = Bun.spawnSync([binary, '--version'], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toMatch(/\d+\.\d+/)
  })

  it('creates, edits, and reads docx / xlsx / pptx including Chinese paths', () => {
    if (!binary) return
    const root = mkdtempSync(join(tmpdir(), 'officecli-smoke-'))
    const workDir = join(root, '巡察工作')
    mkdirSync(workDir, { recursive: true })

    const run = (args: string[]) => {
      const result = Bun.spawnSync([binary, ...args], {
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          OFFICECLI_NO_AUTO_RESIDENT: '1',
        },
      })
      const output = `${result.stdout.toString()}${result.stderr.toString()}`
      if (result.exitCode !== 0) {
        throw new Error(`officecli ${args.join(' ')} failed (${result.exitCode}): ${output}`)
      }
      return output
    }

    try {
      const docx = join(workDir, '报告.docx')
      const xlsx = join(workDir, '数据.xlsx')
      const pptx = join(workDir, '汇报.pptx')

      run(['create', docx])
      run(['add', docx, '/body', '--type', 'paragraph', '--prop', 'text=巡察工作摘要', '--prop', 'style=Heading1'])
      const docxText = run(['view', docx, 'text'])
      expect(docxText).toContain('巡察工作摘要')
      run(['validate', docx])

      run(['create', xlsx])
      run(['set', xlsx, '/Sheet1/A1', '--prop', 'value=姓名', '--prop', 'bold=true'])
      run(['set', xlsx, '/Sheet1/A2', '--prop', 'value=张三'])
      const xlsxText = run(['view', xlsx, 'text'])
      expect(xlsxText).toMatch(/姓名|张三/)

      run(['create', pptx])
      run(['add', pptx, '/', '--type', 'slide', '--prop', 'title=巡察汇报'])
      const pptxText = run(['view', pptx, 'text'])
      expect(pptxText).toContain('巡察汇报')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('prints specialized skill content via load_skill', () => {
    if (!binary) return
    const result = Bun.spawnSync([binary, 'load_skill', 'word'], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain('docx')
  })

  it('resolves the bundled official skill directory', () => {
    const skillsDir = getBundledOfficecliSkillsDir()
    expect(skillsDir).toBeTruthy()
    for (const slug of BUNDLED_OFFICECLI_SKILL_SLUGS) {
      expect(existsSync(join(skillsDir!, slug, 'SKILL.md'))).toBe(true)
    }
  })
})
