import { describe, expect, it } from 'bun:test'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { OFFICECLI_DESKTOP_TARGETS, OFFICECLI_SHA256 } from '../../../../../scripts/build/common.ts'
import {
  listingHasRequiredOutlineHeadings,
  repairDocxOutlineHeadings,
  styleHasAnyOutlineLevel,
  styleHasOutlineLevel,
} from '../../../../../apps/electron/resources/scripts/officecli-heading-repair.ts'
import {
  BUNDLED_OFFICECLI_SKILL_SLUGS,
  BUNDLED_OFFICECLI_LOAD_SKILL_ALIASES,
  collectOfficeFormatSkillSlugs,
  docxOutlineEnsureTiming,
  findDocxArgInOfficecliArgs,
  getBundledOfficecliRouterSkillMd,
  getBundledOfficecliSkillsDir,
  getOfficecliWrapperDir,
  isBundledOfficecliLoadSkillCommand,
  officecliBinaryName,
  officecliWrapperName,
  resolveBundledOfficecliSkillRead,
  resolveOfficecliBinary,
  resolveOfficecliResourcesRoot,
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

  it('requires an Office action for product wording without a file path', () => {
    expect(collectOfficeFormatSkillSlugs('把他形成word报告（带目录）')).toEqual(['officecli-docx'])
    expect(collectOfficeFormatSkillSlugs('撰写一份 Word 文档')).toEqual(['officecli-docx'])
    expect(collectOfficeFormatSkillSlugs('做成一份 Excel 表')).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('用 Excel 分析这份 CSV')).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('做个 ppt 给董事会')).toEqual(['officecli-pptx'])
    expect(collectOfficeFormatSkillSlugs('解释 DCF')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('查看 DCF 的计算方法')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('读取这篇学术论文')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('检查 Morph 动画原理')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('分析数据')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('制作网页 Dashboard')).toEqual([])
    expect(collectOfficeFormatSkillSlugs('创建一份财务模型')).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('生成一个 3D Morph 演示文稿')).toEqual(['officecli-pptx'])
  })

  it('locks only the automatic officecli router and leaves explicit format skills alone', () => {
    const router = getBundledOfficecliRouterSkillMd()
    expect(router).toBeTruthy()
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'officecli-docx', 'SKILL.md'),
    )).toBeUndefined()
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'officecli', 'SKILL.md'),
    )).toBe(router)
    expect(resolveBundledOfficecliSkillRead(
      join(homedir(), '.agents', 'skills', 'docx', 'SKILL.md'),
    )).toBeUndefined()
  })

  it('infers from Office attachments without guessing an unknown format', () => {
    expect(collectOfficeFormatSkillSlugs('看一下', [
      { type: 'office', name: '数据.xlsx', path: '/tmp/数据.xlsx' },
    ])).toEqual(['officecli-xlsx'])
    expect(collectOfficeFormatSkillSlugs('看一下', [
      { type: 'office', name: '附件', storedPath: '/tmp/session/att-1' },
    ])).toEqual([])
    expect(collectOfficeFormatSkillSlugs('读取', [
      { type: 'office', name: '宏文档.DOCM', storedPath: '/tmp/session/宏文档.DOCM' },
    ])).toEqual(['officecli-docx'])
  })
})

describe('isBundledOfficecliLoadSkillCommand', () => {
  it('allows exact bundled guide loads only', () => {
    expect(isBundledOfficecliLoadSkillCommand('officecli load_skill word')).toBe(true)
    expect(isBundledOfficecliLoadSkillCommand(' officecli load_skill morph-ppt-3d ')).toBe(true)
    expect(isBundledOfficecliLoadSkillCommand('officecli load_skill word && officecli load_skill academic-paper')).toBe(true)
    expect(isBundledOfficecliLoadSkillCommand('officecli load_skill excel\nofficecli load_skill data-dashboard')).toBe(true)
    expect(isBundledOfficecliLoadSkillCommand('officecli load_skill unknown')).toBe(false)
    expect(isBundledOfficecliLoadSkillCommand('officecli load_skill word; echo unsafe')).toBe(false)
  })
})

describe('OfficeCLI POSIX transparent wrapper', () => {
  it('forwards commands and does not synthesize a close', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'officecli-wrapper-forward-'))
    try {
      const binDir = join(root, 'resources', 'bin')
      const platformDir = join(binDir, `${process.platform}-${process.arch}`)
      mkdirSync(platformDir, { recursive: true })
      const wrapper = join(binDir, 'officecli')
      copyFileSync(join(process.cwd(), 'apps', 'electron', 'resources', 'bin', 'officecli'), wrapper)
      chmodSync(wrapper, 0o755)

      const invocations = join(root, 'invocations.txt')
      const binary = join(platformDir, 'officecli')
      writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(invocations)}\nexit 0\n`)
      chmodSync(binary, 0o755)

      const report = join(root, 'report.docx')
      for (const args of [
        ['raw-set', report, '/document'],
        ['add-part', report, '/'],
        ['import', report, '/workbook', join(root, 'input.csv')],
        ['merge', join(root, 'template.docx'), report],
        ['refresh', report],
        ['help', 'docx', 'add', 'toc'],
        ['load_skill', 'word'],
        ['--version'],
      ]) {
        const result = Bun.spawnSync([wrapper, ...args], { stdout: 'pipe', stderr: 'pipe' })
        expect(result.exitCode).toBe(0)
      }
      const log = readFileSync(invocations, 'utf8')
      expect(log).toContain(`raw-set ${report} /document`)
      expect(log).toContain('load_skill word')
      expect(log.split('\n').some(line => /^close(?:\s|$)/.test(line))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('resolveOfficecliBinary', () => {
  it('names the Windows executable with .exe', () => {
    expect(officecliBinaryName('win32')).toBe('officecli.exe')
    expect(officecliBinaryName('darwin')).toBe('officecli')
    expect(officecliWrapperName('win32')).toBe('officecli.cmd')
    expect(officecliWrapperName('darwin')).toBe('officecli')
  })

  it('ships PATH wrappers for both Unix and Windows shells', () => {
    const binDir = join(process.cwd(), 'apps', 'electron', 'resources', 'bin')
    const sh = readFileSync(join(binDir, 'officecli'), 'utf8')
    const cmd = readFileSync(join(binDir, 'officecli.cmd'), 'utf8')
    expect(sh).toContain('win32-x64/officecli.exe')
    expect(sh).toContain('officecli-heading-repair.ts')
    expect(cmd).toContain('win32-x64\\officecli.exe')
    expect(cmd).toContain('officecli-wrapper.ts')
    expect(sh).not.toContain('command -v bun')
    expect(cmd).not.toContain('set "BUN_BIN=bun"')
    expect(sh).not.toContain('sanitize')
    expect(cmd).not.toContain('sanitize')
    const builder = readFileSync(join(process.cwd(), 'apps', 'electron', 'electron-builder.yml'), 'utf8')
    expect(builder).toContain('to: app/vendor/bun/bun.exe')
    const devScript = readFileSync(join(process.cwd(), 'scripts', 'electron-dev.ts'), 'utf8')
    expect(devScript).toContain('ensureTrustedBunForDev()')
    const electronMain = readFileSync(join(process.cwd(), 'apps', 'electron', 'src', 'main', 'index.ts'), 'utf8')
    expect(electronMain).toContain('process.env.CRAFT_OFFICECLI = officecliWrapper')
    expect(electronMain).not.toContain("process.env.CRAFT_OFFICECLI = officecliBinary")
    expect(electronMain).not.toContain('const officecliResources = process.env.CRAFT_OFFICECLI_RESOURCES')
    expect(existsSync(join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-wrapper.ts'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-heading-repair.ts'))).toBe(true)
    const windowsLauncher = readFileSync(join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-wrapper.ts'), 'utf8')
    expect(windowsLauncher).toContain("from './officecli-heading-repair.ts'")
    expect(windowsLauncher).not.toContain('packages/shared')
    expect(existsSync(join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-wrapper.js'))).toBe(false)
    expect(existsSync(join(binDir, 'officecli-ensure-docx-styles'))).toBe(false)
    expect(existsSync(join(binDir, 'officecli-ensure-docx-styles.cmd'))).toBe(false)
    expect(existsSync(join(binDir, 'officecli-ensure-docx-styles.json'))).toBe(false)
    expect(existsSync(join(binDir, 'officecli-morph-helper'))).toBe(true)
    expect(existsSync(join(binDir, 'officecli-morph-helper.cmd'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-morph-helper.ts'))).toBe(true)
    const serverBuild = readFileSync(join(process.cwd(), 'scripts', 'build-server.ts'), 'utf8')
    expect(serverBuild).toContain("join(outputDir, 'resources', 'bin', platformKey, destName)")
    expect(serverBuild).toContain('export CRAFT_OFFICECLI_RESOURCES="$ROOT/resources/officecli"')
    expect(serverBuild).toContain('ENV CRAFT_OFFICECLI_RESOURCES=/app/resources/officecli')
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

  it('does not trust an OfficeCLI wrapper planted in the session cwd', () => {
    const sessionCwd = mkdtempSync(join(tmpdir(), 'selection-untrusted-officecli-'))
    try {
      const plantedDir = join(sessionCwd, 'resources', 'bin')
      mkdirSync(plantedDir, { recursive: true })
      writeFileSync(join(plantedDir, 'officecli'), '#!/bin/sh\necho untrusted\n')
      const appRootPath = process.cwd()
      expect(getOfficecliWrapperDir({
        cwd: sessionCwd,
        appRootPath,
        trustEnvironment: false,
      })).toBe(join(appRootPath, 'apps', 'electron', 'resources', 'bin'))
      expect(resolveOfficecliBinary({
        cwd: sessionCwd,
        appRootPath,
        trustEnvironment: false,
      })).toContain(join('apps', 'electron', 'resources', 'bin'))
    } finally {
      rmSync(sessionCwd, { recursive: true, force: true })
    }
  })

  it('continues through valid trusted roots when another configured root is missing', () => {
    const appRootPath = process.cwd()
    expect(getOfficecliWrapperDir({
      cwd: '/tmp/untrusted-officecli-cwd',
      appRootPath,
      resourcesPath: join(appRootPath, 'definitely-missing-resources-root'),
      trustEnvironment: false,
    })).toBe(join(appRootPath, 'apps', 'electron', 'resources', 'bin'))
    expect(resolveOfficecliBinary({
      cwd: '/tmp/untrusted-officecli-cwd',
      appRootPath,
      resourcesPath: join(appRootPath, 'definitely-missing-resources-root'),
      trustEnvironment: false,
    })).toContain(join('apps', 'electron', 'resources', 'bin'))
  })

  it('resolves packaged wrappers from CRAFT_RESOURCES_BASE', () => {
    const packaged = mkdtempSync(join(tmpdir(), 'selection-packaged-officecli-'))
    const sessionCwd = mkdtempSync(join(tmpdir(), 'selection-officecli-cwd-'))
    try {
      const binDir = join(packaged, 'resources', 'bin')
      mkdirSync(binDir, { recursive: true })
      writeFileSync(join(binDir, 'officecli'), '#!/bin/sh\necho packaged\n')
      writeFileSync(join(binDir, 'officecli.cmd'), '@echo packaged\r\n')
      expect(getOfficecliWrapperDir({
        cwd: sessionCwd,
        env: { CRAFT_RESOURCES_BASE: packaged },
      })).toBe(binDir)
    } finally {
      rmSync(packaged, { recursive: true, force: true })
      rmSync(sessionCwd, { recursive: true, force: true })
    }
  })

  it('ignores untrusted OfficeCLI resource environment overrides', () => {
    const trusted = mkdtempSync(join(tmpdir(), 'selection-trusted-officecli-resources-'))
    const untrusted = mkdtempSync(join(tmpdir(), 'selection-untrusted-officecli-resources-'))
    try {
      const trustedResources = join(trusted, 'resources', 'officecli')
      const untrustedResources = join(untrusted, 'officecli')
      mkdirSync(trustedResources, { recursive: true })
      mkdirSync(untrustedResources, { recursive: true })
      writeFileSync(join(trustedResources, 'officecli-manifest.json'), '{"version":"trusted"}')
      writeFileSync(join(untrustedResources, 'officecli-manifest.json'), '{"version":"untrusted"}')

      expect(resolveOfficecliResourcesRoot({
        cwd: untrusted,
        appRootPath: trusted,
        trustEnvironment: false,
        env: {
          ...process.env,
          CRAFT_OFFICECLI_RESOURCES: untrustedResources,
          CRAFT_RESOURCES_BASE: untrusted,
        },
      })).toBe(trustedResources)
    } finally {
      rmSync(trusted, { recursive: true, force: true })
      rmSync(untrusted, { recursive: true, force: true })
    }
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

    const run = (args: string[], executable = binary) => {
      const result = Bun.spawnSync([executable, ...args], {
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          OFFICECLI_NO_AUTO_RESIDENT: '1',
        },
      })
      const output = `${result.stdout.toString()}${result.stderr.toString()}`
      if (result.exitCode !== 0 || /\b(?:WARNING|UNSUPPORTED)\b/i.test(output)) {
        throw new Error(`${executable} ${args.join(' ')} returned an incomplete result (${result.exitCode}): ${output}`)
      }
      return output
    }

    try {
      const docx = join(workDir, '报告.docx')
      const xlsx = join(workDir, '数据.xlsx')
      const pptx = join(workDir, '汇报.pptx')
      const wrapperDir = getOfficecliWrapperDir()
      const wrapper = wrapperDir ? join(wrapperDir, officecliWrapperName()) : binary

      run(['create', docx], wrapper)
      run(['add', docx, '/body', '--type', 'paragraph', '--prop', 'text=巡察工作摘要', '--prop', 'style=Heading1'], wrapper)
      const docxText = run(['view', docx, 'text'])
      expect(docxText).toContain('巡察工作摘要')
      run(['validate', docx])

      run(['create', xlsx])
      run(['set', xlsx, '/Sheet1/A1', '--prop', 'value=姓名', '--prop', 'bold=true'])
      run(['set', xlsx, '/Sheet1/B1', '--prop', 'value=金额', '--prop', 'bold=true'])
      run(['set', xlsx, '/Sheet1/A2', '--prop', 'value=张三'])
      run(['set', xlsx, '/Sheet1/B2', '--prop', 'value=42'])
      run(['add', xlsx, '/', '--type', 'sheet', '--prop', 'name=汇总'])
      run(['set', xlsx, '/汇总/A1', '--prop', 'value=双倍金额'])
      run(['set', xlsx, '/汇总/A2', '--prop', 'formula=Sheet1!B2*2'])
      run([
        'add', xlsx, '/Sheet1', '--type', 'chart', '--prop', 'chartType=column',
        '--prop', 'dataRange=Sheet1!A1:B2', '--prop', 'anchor=D2:J18',
      ])
      const xlsxText = run(['view', xlsx, 'text'])
      expect(xlsxText).toMatch(/姓名|张三/)
      expect(run(['get', xlsx, '/汇总/A2', '--json'])).toContain('Sheet1!B2*2')
      expect(run(['get', xlsx, '/Sheet1/chart[1]', '--json'])).toMatch(/column|chartType/i)
      run(['validate', xlsx])

      run(['create', pptx])
      run(['add', pptx, '/', '--type', 'slide', '--prop', 'title=巡察汇报'])
      run(['add', pptx, '/', '--type', 'slide', '--prop', 'title=关键发现'])
      run(['add', pptx, '/slide[2]', '--type', 'notes', '--prop', 'text=重点说明整改进度'])
      run([
        'add', pptx, '/slide[2]', '--type', 'chart', '--prop', 'chartType=column',
        '--prop', 'series1.name=完成率', '--prop', 'series1.values=70,85,95',
        '--prop', 'categories=一季度,二季度,三季度',
        '--prop', 'x=2cm', '--prop', 'y=4cm', '--prop', 'width=20cm', '--prop', 'height=10cm',
      ])
      const pptxText = run(['view', pptx, 'text'])
      expect(pptxText).toContain('巡察汇报')
      expect(pptxText).toContain('关键发现')
      expect(run(['get', pptx, '/slide[2]/notes', '--json'])).toContain('重点说明整改进度')
      expect(run(['get', pptx, '/slide[2]/chart[1]', '--json'])).toMatch(/完成率|chartType/i)
      run(['validate', pptx])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('prints every specialized skill in full via load_skill', () => {
    if (!binary) return
    for (const alias of BUNDLED_OFFICECLI_LOAD_SKILL_ALIASES) {
      const result = Bun.spawnSync([binary, 'load_skill', alias], { stdout: 'pipe', stderr: 'pipe' })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString().length).toBeGreaterThan(500)
    }
  })

  it('runs the cross-platform Morph helper on the bundled Bun runtime', () => {
    if (!binary) return
    const root = mkdtempSync(join(tmpdir(), 'officecli-morph-helper-'))
    const helper = join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', 'officecli-morph-helper.ts')
    const deck = join(root, '形变 演示.pptx')
    const env = { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: '1' }
    const run = (argv: string[]) => Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe', env })
    try {
      expect(run([binary, 'create', deck]).exitCode).toBe(0)
      expect(run([binary, 'add', deck, '/', '--type', 'slide', '--prop', 'title=起点']).exitCode).toBe(0)
      const cloned = run([process.execPath, helper, binary, 'clone', deck, '1', '2'])
      expect(cloned.exitCode).toBe(0)
      const readback = run([binary, 'get', deck, '/slide[2]', '--json'])
      expect(readback.exitCode).toBe(0)
      expect(readback.stdout.toString()).toContain('morph')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('uses atomic batch with read-back and preserves XLSM macro parts', () => {
    if (!binary) return
    const root = mkdtempSync(join(tmpdir(), 'officecli-xlsm-'))
    const env = { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: '1' }
    const run = (args: string[]) => {
      const result = Bun.spawnSync([binary, ...args], { stdout: 'pipe', stderr: 'pipe', env })
      const output = `${result.stdout.toString()}${result.stderr.toString()}`
      if (result.exitCode !== 0 || /\b(?:WARNING|UNSUPPORTED)\b/i.test(output)) {
        throw new Error(`officecli ${args.join(' ')} returned an incomplete result: ${output}`)
      }
      return output
    }
    try {
      const workbook = join(root, '批量导入.xlsx')
      const payload = join(root, 'atomic-batch.json')
      run(['create', workbook])
      writeFileSync(payload, JSON.stringify([
        { command: 'set', path: '/Sheet1/A1', props: { value: '姓名', bold: true } },
        { command: 'set', path: '/Sheet1/B1', props: { value: '金额', bold: true } },
        { command: 'set', path: '/Sheet1/A2', props: { value: '张三' } },
        { command: 'set', path: '/Sheet1/B2', props: { value: 42 } },
      ]))
      run(['batch', workbook, '--input', payload])
      const readback = run(['get', workbook, '/Sheet1/A1:B2', '--json'])
      expect(readback).toContain('姓名')
      expect(readback).toContain('张三')
      expect(readback).toContain('42')

      const parts = unzipSync(new Uint8Array(readFileSync(workbook)))
      const macro = strToU8('Selection macro preservation fixture')
      parts['xl/vbaProject.bin'] = macro
      parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
      ))
      parts['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(parts['xl/_rels/workbook.xml.rels']!).replace(
        '</Relationships>',
        '<Relationship Id="rIdSelectionVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
      ))
      const macroWorkbook = join(root, '含宏 工作簿.xlsm')
      writeFileSync(macroWorkbook, Buffer.from(zipSync(parts)))

      run(['set', macroWorkbook, '/Sheet1/C1', '--prop', 'value=宏保持'])
      run(['validate', macroWorkbook])
      const updatedParts = unzipSync(new Uint8Array(readFileSync(macroWorkbook)))
      expect(updatedParts['xl/vbaProject.bin']).toEqual(macro)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('resolves the bundled official skill directory', () => {
    const skillsDir = getBundledOfficecliSkillsDir()
    expect(skillsDir).toBeTruthy()
    for (const slug of BUNDLED_OFFICECLI_SKILL_SLUGS) {
      expect(existsSync(join(skillsDir!, slug, 'SKILL.md'))).toBe(true)
    }
  })
})

describe('docx outline heading seed', () => {
  it('repairs only immediately after Word creation', () => {
    expect(findDocxArgInOfficecliArgs(['create', '报告.docx'])).toBe('报告.docx')
    expect(findDocxArgInOfficecliArgs(['create', 'sheet.xlsx'])).toBeUndefined()
    expect(docxOutlineEnsureTiming(['create', 'a.docx'])).toEqual({ before: false, after: true })
    expect(docxOutlineEnsureTiming(['open', 'a.docx'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['refresh', 'a.docx'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['view', 'a.docx', 'text'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['add', 'a.docx', '/body', '--prop', 'style=Heading1'])).toEqual({ before: false, after: false })
    expect(docxOutlineEnsureTiming(['add', 'a.docx', '/styles', '--type', 'style', '--prop', 'id=Heading1'])).toEqual({
      before: false,
      after: false,
    })
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type', 'toc'])).toBe(false)
    expect(shouldEnsureDocxOutlineStyles(['add', 'a.docx', '--type=toc'])).toBe(false)
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
    expect(styleHasOutlineLevel(listing, 'Heading1', 0)).toBe(false)
    expect(styleHasOutlineLevel(listing, 'Heading2', 1)).toBe(true)
    expect(listingHasRequiredOutlineHeadings(listing)).toBe(false)

    const complete = [
      '/styles/style[2] (style) type=paragraph styleId=Heading1 name=Heading1',
      '/styles/style[2]/pPr[1] (pPr) children=1 outlineLvl=0',
      '/styles/style[3] (style) type=paragraph styleId=Heading2 name=Heading2',
      '/styles/style[3]/pPr[1] (pPr) children=1 outlineLvl=1',
      '/styles/style[4] (style) type=paragraph styleId=Heading3 name=Heading3',
      '/styles/style[4]/pPr[1] (pPr) children=1 outlineLvl=2',
    ].join('\n')
    expect(listingHasRequiredOutlineHeadings(complete)).toBe(true)
  })

  it('recognizes an existing custom outline level without treating it as missing', () => {
    const listing = [
      '/styles/style[2] (style) type=paragraph styleId=Heading1 name=CustomHeading',
      '/styles/style[2]/pPr[1] (pPr) children=1 outlineLvl=4',
    ].join('\n')
    expect(styleHasAnyOutlineLevel(listing, 'Heading1')).toBe(true)
    expect(styleHasOutlineLevel(listing, 'Heading1', 0)).toBe(false)
  })

  it('documents the official skill closed loop on the bundled router', () => {
    const router = getBundledOfficecliRouterSkillMd()
    expect(router).toBeTruthy()
    const body = readFileSync(router!, 'utf8')
    expect(body).toContain('officecli load_skill word')
    expect(body).toContain('Load only what the task needs')
    expect(body).toContain('Delivery gate')
    expect(body).toContain('outlineLvl')
    expect(body).toContain('Do not impose a model-call, CLI-call, operation, QA, elapsed-time, or cost budget')
  })

  it('seeds on wrapper create and repairs Heading1 that exists without outlineLvl', () => {
    const binary = resolveOfficecliBinary()
    const wrapperDir = getOfficecliWrapperDir()
    if (!binary || !wrapperDir) return

    const wrapper = join(wrapperDir, officecliWrapperName())
    const root = mkdtempSync(join(tmpdir(), 'officecli-heading-'))
    const touchedFiles: string[] = []
    const env = {
      ...process.env,
      CRAFT_OFFICECLI: binary,
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
      touchedFiles.push(raw)
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
      expect(repairDocxOutlineHeadings(binary, raw).ok).toBe(true)
      const repaired = run([binary, 'get', raw, '/styles/Heading1'])
      expect(repaired.output).toMatch(/outlineLvl=0/)
      expect(repaired.output).toMatch(/size=16pt/)

      const viaWrapper = join(root, 'wrapper.docx')
      touchedFiles.push(viaWrapper)
      expect(run([wrapper, 'create', viaWrapper]).exitCode).toBe(0)
      const listing = run([binary, 'get', viaWrapper, '/styles', '--depth', '2'])
      expect(listingHasRequiredOutlineHeadings(listing.output)).toBe(true)

      const headingAdd = run([
        wrapper, 'add', viaWrapper, '/body', '--type', 'paragraph',
        '--prop', 'text=一、背景', '--prop', 'style=Heading1',
      ])
      expect(headingAdd.exitCode).toBe(0)
      expect(headingAdd.output).not.toMatch(/style 'Heading1' not found/i)
      expect(run([
        wrapper, 'add', viaWrapper, '/body', '--type', 'paragraph',
        '--prop', 'text=二、发现', '--prop', 'style=Heading2',
      ]).exitCode).toBe(0)
      expect(run([
        wrapper, 'add', viaWrapper, '/body', '--type', 'paragraph',
        '--prop', 'text=（一）整改', '--prop', 'style=Heading3',
      ]).exitCode).toBe(0)
      expect(run([
        wrapper, 'add', viaWrapper, '/body', '--type', 'toc',
        '--prop', 'levels=1-3', '--prop', 'title=目录', '--prop', 'hyperlinks=true', '--index', '0',
      ]).exitCode).toBe(0)
      expect(run([wrapper, 'set', viaWrapper, '/settings', '--prop', 'updateFields=true']).exitCode).toBe(0)
      expect(run([wrapper, 'save', viaWrapper]).exitCode).toBe(0)
      expect(run([wrapper, 'get', viaWrapper, '/toc[1]', '--depth', '2']).output).toContain('TOC')
      expect(run([wrapper, 'validate', viaWrapper]).exitCode).toBe(0)
      expect(run([wrapper, 'close', viaWrapper]).exitCode).toBe(0)
      expect(run([wrapper, 'view', viaWrapper, 'outline']).output).toMatch(/一、背景|二、发现/)

      const custom = join(root, 'custom-outline.docx')
      touchedFiles.push(custom)
      expect(run([binary, 'create', custom]).exitCode).toBe(0)
      expect(run([
        binary, 'add', custom, '/styles', '--type', 'style',
        '--prop', 'id=Heading1', '--prop', 'type=paragraph',
        '--prop', 'name=CustomHeading1', '--prop', 'outlineLvl=4', '--prop', 'size=16pt',
      ]).exitCode).toBe(0)
      const customRepair = repairDocxOutlineHeadings(binary, custom)
      expect(customRepair.ok).toBe(false)
      expect(customRepair.error).toContain('left it unchanged')
      const customAfter = run([binary, 'get', custom, '/styles/Heading1'])
      expect(customAfter.output).toMatch(/outlineLvl=4/)
      expect(customAfter.output).not.toMatch(/outlineLvl=0/)
    } finally {
      for (const file of touchedFiles) {
        if (existsSync(file)) run([binary, 'close', file])
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
