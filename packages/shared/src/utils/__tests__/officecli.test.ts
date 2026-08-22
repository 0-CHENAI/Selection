import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { OFFICECLI_DESKTOP_TARGETS, OFFICECLI_SHA256 } from '../../../../../scripts/build/common.ts'
import {
  BUNDLED_OFFICECLI_SKILL_SLUGS,
  OFFICECLI_ENSURE_DOCX_STYLES_JSON,
  collectOfficeFormatSkillSlugs,
  docxOutlineEnsureTiming,
  docxStylesListingHasOutlineHeadings,
  ensureDocxOutlineHeadingStyles,
  findDocxArgInOfficecliArgs,
  getBundledOfficecliRouterSkillMd,
  getBundledOfficecliSkillsDir,
  getOfficecliWrapperDir,
  officecliBinaryName,
  resolveBundledOfficecliSkillRead,
  resolveOfficecliBinary,
  shouldEnsureDocxOutlineStyles,
  styleListingHasOutlineLvl,
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
    expect(existsSync(join(binDir, OFFICECLI_ENSURE_DOCX_STYLES_JSON))).toBe(true)
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
  it('detects create / heading / TOC writes and ignores open / view', () => {
    expect(findDocxArgInOfficecliArgs(['create', '报告.docx'])).toBe('报告.docx')
    expect(findDocxArgInOfficecliArgs(['create', 'sheet.xlsx'])).toBeUndefined()
    expect(docxOutlineEnsureTiming(['create', 'a.docx'])).toEqual({ before: false, after: true })
    expect(docxOutlineEnsureTiming(['open', 'a.docx'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['refresh', 'a.docx'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['view', 'a.docx', 'text'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['add', 'a.docx', '/body', '--prop', 'style=Heading1'])).toEqual({
      before: true,
      after: false,
    })
    expect(docxOutlineEnsureTiming(['add', 'a.docx', '/styles', '--type', 'style', '--prop', 'id=Heading1'])).toEqual({
      before: false,
      after: true,
    })
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type', 'toc'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type=toc'])).toBe(true)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '/body', '--prop', 'text=摘要'])).toBe(false)
    expect(shouldEnsureDocxOutlineStyles(['create', 'a.xlsx'])).toBe(false)
  })

  it('requires outlineLvl on the matching Heading block, not a later style', () => {
    const listing = [
      '/styles/style[2] (style) type=paragraph styleId=Heading1 name=Heading1',
      '/styles/style[2]/name[1] (name) val=Heading1',
      '/styles/style[2]/rPr[1] (rPr) children=2 sz=36',
      '/styles/style[3] (style) type=paragraph styleId=Heading2 name=Heading2',
      '/styles/style[3]/pPr[1] (pPr) children=1 outlineLvl=1',
    ].join('\n')
    expect(styleListingHasOutlineLvl(listing, 'Heading1', 0)).toBe(false)
    expect(styleListingHasOutlineLvl(listing, 'Heading2', 1)).toBe(true)
    expect(docxStylesListingHasOutlineHeadings(listing)).toBe(false)

    const complete = [
      '/styles/style[2] (style) type=paragraph styleId=Heading1 name=Heading1',
      '/styles/style[2]/pPr[1] (pPr) children=1 outlineLvl=0',
      '/styles/style[3] (style) type=paragraph styleId=Heading2 name=Heading2',
      '/styles/style[3]/pPr[1] (pPr) children=1 outlineLvl=1',
      '/styles/style[4] (style) type=paragraph styleId=Heading3 name=Heading3',
      '/styles/style[4]/pPr[1] (pPr) children=1 outlineLvl=2',
    ].join('\n')
    expect(docxStylesListingHasOutlineHeadings(complete)).toBe(true)
  })

  it('documents the official skill closed loop on the bundled router', () => {
    const router = getBundledOfficecliRouterSkillMd()
    expect(router).toBeTruthy()
    const body = readFileSync(router!, 'utf8')
    expect(body).toContain('officecli load_skill word')
    expect(body).toContain('outlineLvl')
    expect(body).toContain('style not found')
    expect(body).toContain('Do not `add` an existing Heading style')
  })

  it('seeds on wrapper create and repairs Heading1 that exists without outlineLvl', () => {
    const binary = resolveOfficecliBinary()
    const wrapperDir = getOfficecliWrapperDir()
    if (!binary || !wrapperDir) return

    const wrapper = join(wrapperDir, 'officecli')
    const root = mkdtempSync(join(tmpdir(), 'officecli-heading-'))
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
      const raw = join(root, 'raw.docx')
      expect(run([binary, 'create', raw]).exitCode).toBe(0)
      expect(run([binary, 'get', raw, '/styles/Heading1']).exitCode).not.toBe(0)
      expect(run([wrapper, 'view', raw, 'text']).exitCode).toBe(0)
      expect(run([binary, 'get', raw, '/styles/Heading1']).exitCode).not.toBe(0)

      run([
        binary, 'add', raw, '/styles', '--type', 'style',
        '--prop', 'id=Heading1', '--prop', 'type=paragraph',
        '--prop', 'name=Heading1', '--prop', 'size=16pt',
      ])
      const beforeRepair = run([binary, 'get', raw, '/styles/Heading1'])
      expect(beforeRepair.exitCode).toBe(0)
      expect(beforeRepair.output).not.toMatch(/outlineLvl=/)
      expect(ensureDocxOutlineHeadingStyles(raw, { binary })).toBe(true)
      const repaired = run([binary, 'get', raw, '/styles/Heading1'])
      expect(repaired.output).toMatch(/outlineLvl=0/)
      expect(repaired.output).toMatch(/size=16pt/)

      const viaWrapper = join(root, 'wrapper.docx')
      expect(run([wrapper, 'create', viaWrapper]).exitCode).toBe(0)
      const listing = run([binary, 'get', viaWrapper, '/styles', '--depth', '2'])
      expect(docxStylesListingHasOutlineHeadings(listing.output)).toBe(true)

      run([
        binary, 'add', viaWrapper, '/styles', '--type', 'style',
        '--prop', 'id=Heading1', '--prop', 'type=paragraph',
        '--prop', 'name=Heading1', '--prop', 'size=16pt',
      ])
      expect(run([binary, 'get', viaWrapper, '/styles/Heading1']).output).not.toMatch(/outlineLvl=/)
      const addAfterWipe = run([
        wrapper, 'add', viaWrapper, '/styles', '--type', 'style',
        '--prop', 'id=Heading1', '--prop', 'type=paragraph',
        '--prop', 'name=Heading1', '--prop', 'size=16pt',
      ])
      expect(addAfterWipe.exitCode).toBe(0)
      expect(run([binary, 'get', viaWrapper, '/styles/Heading1']).output).toMatch(/outlineLvl=0/)

      const headingAdd = run([
        wrapper, 'add', viaWrapper, '/body', '--type', 'paragraph',
        '--prop', 'text=一、背景', '--prop', 'style=Heading1',
      ])
      expect(headingAdd.exitCode).toBe(0)
      expect(headingAdd.output).not.toMatch(/style 'Heading1' not found/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
