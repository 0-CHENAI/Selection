import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { OFFICECLI_DESKTOP_TARGETS, OFFICECLI_SHA256 } from '../../../../../scripts/build/common.ts'
import { officecliBinaryName, resolveOfficecliBinary } from '../officecli'

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
})
