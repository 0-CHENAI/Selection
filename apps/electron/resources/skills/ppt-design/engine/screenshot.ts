import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScreenshotResult } from './types.ts'

export type CaptureOptions = {
  officecli?: string
  libreoffice?: string
  pdftoppm?: string
}

export async function captureSlides(pptx: string, outDir: string, pageCount: number, options: CaptureOptions = {}): Promise<ScreenshotResult> {
  mkdirSync(outDir, { recursive: true })
  const officecli = options.officecli === '' ? null : (options.officecli ?? await commandOnPath('officecli'))
  if (officecli && pageCount > 0) {
    const files: string[] = []
    let failed = false
    for (let page = 1; page <= pageCount; page++) {
      const target = join(outDir, `slide-${String(page).padStart(2, '0')}.png`)
      const result = await run(officecli, ['view', pptx, 'screenshot', '--page', String(page), '-o', target], { OFFICECLI_SKIP_UPDATE: '1' })
      if (result.code !== 0) {
        failed = true
        break
      }
      files.push(target)
    }
    if (!failed && files.length === pageCount) return { available: true, renderer: 'officecli', files }
  }
  const soffice = options.libreoffice ?? await commandOnPath('soffice') ?? await commandOnPath('libreoffice')
  const pdftoppm = options.pdftoppm ?? await commandOnPath('pdftoppm')
  if (!soffice || !pdftoppm) {
    return {
      available: false,
      files: [],
      reason: '没有可用的 OfficeCLI 截图或 LibreOffice + pdftoppm。导出的 PPTX 仍然有效，但这一步不能做视觉自查。',
    }
  }
  const profile = mkdtempSync(join(tmpdir(), 'selection-lo-'))
  const pdf = await run(soffice, [
    '--headless',
    '--norestore',
    '--nolockcheck',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to', 'pdf',
    '--outdir', outDir,
    pptx,
  ])
  rmSync(profile, { recursive: true, force: true })
  if (pdf.code !== 0) return { available: false, files: [], renderer: 'libreoffice', reason: pdf.stderr || pdf.stdout || 'LibreOffice 转换失败' }
  const prefix = join(outDir, 'slide')
  const png = await run(pdftoppm, ['-png', '-r', '108', join(outDir, pptxBasename(pptx) + '.pdf'), prefix])
  if (png.code !== 0) return { available: false, files: [], renderer: 'libreoffice', reason: png.stderr || 'pdftoppm 失败' }
  const files = readdirSync(outDir)
    .filter(name => /^slide-?\d+\.png$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1] ?? 0) - Number(b.match(/(\d+)/)?.[1] ?? 0))
    .map(name => join(outDir, name))
  if (pageCount > 0 && files.length < pageCount) {
    return { available: false, files, renderer: 'libreoffice', reason: `只得到 ${files.length} 张 PNG，deck 有 ${pageCount} 页` }
  }
  return { available: true, renderer: 'libreoffice', files: pageCount > 0 ? files.slice(0, pageCount) : files }
}

function pptxBasename(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? 'deck.pptx'
  return name.replace(/\.pptx$/i, '')
}

async function commandOnPath(name: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const result = await run(finder, [name])
  if (result.code !== 0) return null
  const found = result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean)
  return found || null
}

function run(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv } })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => resolve({ code: 1, stdout, stderr: error.message }))
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
  })
}
