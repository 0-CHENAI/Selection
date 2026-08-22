import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { OFFICECLI_DESKTOP_TARGETS, OFFICECLI_SHA256 } from '../../../../../scripts/build/common.ts'
import {
  BUNDLED_OFFICECLI_SKILL_SLUGS,
  collectOfficeFormatSkillSlugs,
  ensureDocxOutlineHeadingStyles,
  findDocxArgInOfficecliArgs,
  getBundledOfficecliRouterSkillMd,
  getBundledOfficecliSkillsDir,
  getOfficecliWrapperDir,
  officecliBinaryName,
  resolveBundledOfficecliSkillRead,
  resolveOfficecliBinary,
  shouldEnsureDocxOutlineStyles,
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

  it('infers from Word / Excel / PowerPoint wording without a file path', () => {
    expect(collectOfficeFormatSkillSlugs('把他形成word报告（带目录）')).toEqual(['officecli-docx'])
    expect(collectOfficeFormatSkillSlugs('做成一份 Excel 表')).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('做个 ppt 给董事会')).toEqual(['officecli-pptx'])
  })

  it('rewrites ~/.agents officecli / docx paths to the bundled skills even if they exist', () => {
    const bundled = getBundledOfficecliSkillsDir()
    const router = getBundledOfficecliRouterSkillMd()
    expect(bundled).toBeTruthy()
    expect(router).toBeTruthy()
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'officecli-docx', 'SKILL.md'),
    )).toBe(join(bundled!, 'officecli-docx', 'SKILL.md'))
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'officecli', 'SKILL.md'),
    )).toBe(router)
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'docx', 'SKILL.md'),
    )).toBe(join(bundled!, 'officecli-docx', 'SKILL.md'))
    expect(resolveBundledOfficecliSkillRead(join(bundled!, 'officecli-docx', 'SKILL.md'))).toBeUndefined()
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
    expect(sh).toContain('officecli-ensure-docx-styles')
    expect(cmd).toContain('CRAFT_OFFICECLI')
    expect(cmd).toContain('win32-x64\\officecli.exe')
    expect(cmd).toContain('officecli-ensure-docx-styles.cmd')
    expect(existsSync(join(binDir, 'officecli-ensure-docx-styles'))).toBe(true)
    expect(existsSync(join(binDir, 'officecli-ensure-docx-styles.cmd'))).toBe(true)
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

describe('docx outline heading seed', () => {
  it('detects create / heading / TOC args that need styles.xml outlineLvl', () => {
    expect(findDocxArgInOfficecliArgs(['create', '报告.docx'])).toBe('报告.docx')
    expect(findDocxArgInOfficecliArgs(['create', 'sheet.xlsx'])).toBeUndefined()
    expect(shouldEnsureDocxOutlineStyles(['create', 'a.docx'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['open', 'a.docx'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['refresh', 'a.docx'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '/body', '--prop', 'style=Heading1'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type', 'toc'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type=toc'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '/body', '--prop', 'text=摘要'])).toBe(false)
    expect(shouldEnsureDocxOutlineStyles(['view', 'a.docx', 'text'])).toBe(false)
    expect(shouldEnsureDocxOutlineStyles(['create', 'a.xlsx'])).toBe(false)
  })

  it('documents the official skill closed loop on the bundled router', () => {
    const router = getBundledOfficecliRouterSkillMd()
    expect(router).toBeTruthy()
    const body = readFileSync(router!, 'utf8')
    expect(body).toContain('officecli load_skill word')
    expect(body).toContain('outlineLvl')
    expect(body).toContain('style not found')
  })

  it('seeds Heading1–3 with outlineLvl after PATH wrapper create', () => {
    const binary = resolveOfficecliBinary()
    const wrapperDir = getOfficecliWrapperDir()
    if (!binary || !wrapperDir) return

    const wrapper = join(wrapperDir, 'officecli')
    const root = mkdtempSync(join(tmpdir(), 'officecli-heading-'))
    const docx = join(root, '方案.docx')
    const env = {
      ...process.env,
      CRAFT_OFFICECLI: binary,
      OFFICECLI_NO_AUTO_RESIDENT: '1',
    }

    const run = (argv: string[]) => {
      const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe', env })
      return {
        exitCode: result.exitCode,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
      }
    }

    try {
      const rawCreate = run([binary, 'create', docx])
      expect(rawCreate.exitCode).toBe(0)
      expect(run([binary, 'get', docx, '/styles/Heading1']).exitCode).not.toBe(0)

      expect(ensureDocxOutlineHeadingStyles(docx, { binary })).toBe(true)
      expect(run([binary, 'get', docx, '/styles/Heading1']).exitCode).toBe(0)

      const viaHelper = join(root, 'helper.docx')
      expect(run([binary, 'create', viaHelper]).exitCode).toBe(0)
      expect(ensureDocxOutlineHeadingStyles(viaHelper, { binary })).toBe(true)

      const viaWrapper = join(root, 'wrapper.docx')
      const created = run([wrapper, 'create', viaWrapper])
      expect(created.exitCode).toBe(0)
      expect(run([binary, 'get', viaWrapper, '/styles/Heading1']).exitCode).toBe(0)
      expect(run([binary, 'get', viaWrapper, '/styles/Heading2']).exitCode).toBe(0)
      expect(run([binary, 'get', viaWrapper, '/styles/Heading3']).exitCode).toBe(0)

      const styles = Bun.spawnSync(['unzip', '-p', viaWrapper, 'word/styles.xml'], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const xml = styles.stdout.toString()
      expect(xml).toContain('Heading1')
      expect(xml).toContain('Heading2')
      expect(xml).toContain('Heading3')
      expect(xml).toMatch(/w:val="0"/)
      expect(xml).toContain('outlineLvl')

      const addHeading = run([
        wrapper,
        'add',
        viaWrapper,
        '/body',
        '--type',
        'paragraph',
        '--prop',
        'text=一、背景',
        '--prop',
        'style=Heading1',
      ])
      expect(addHeading.exitCode).toBe(0)
      expect(addHeading.output).not.toMatch(/style 'Heading1' not found/i)

      const rawOnly = join(root, 'raw.docx')
      expect(run([binary, 'create', rawOnly]).exitCode).toBe(0)
      const addOnRaw = run([
        wrapper,
        'add',
        rawOnly,
        '/body',
        '--type',
        'paragraph',
        '--prop',
        'text=一、背景',
        '--prop',
        'style=Heading1',
      ])
      expect(addOnRaw.exitCode).toBe(0)
      expect(addOnRaw.output).not.toMatch(/style 'Heading1' not found/i)
      expect(run([binary, 'get', rawOnly, '/styles/Heading1']).exitCode).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
