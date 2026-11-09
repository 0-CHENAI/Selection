import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { argumentLayoutCatalog } from './argument-layouts.ts'
import { checkDeck, formatNeedsRevision, revisionStatus } from './check.ts'
import { exportDeck, platformFromProcess } from './export-pptx.ts'
import { importPptxFile, loadRetained } from './import/project.ts'
import { mergeRetained } from './import/retained.ts'
import { loadDeckFile } from './schema.ts'
import { captureSlides } from './screenshot.ts'
import type { PlatformName, RenderStatus } from './types.ts'

type Flags = {
  command: string
  file?: string
  out?: string
  screenshot?: string
  platform?: PlatformName
  officecli?: string
  pages?: number
  pageNumbers?: number[]
  maxSlides?: number
}

function usage(): never {
  console.log(JSON.stringify({
    status: 'error',
    message: '用法：deck-cli.mjs layouts | check <deck.json> | render <deck.json> --out <file.pptx> [--screenshot <dir>] [--platform mac|win|linux] | screenshot <file.pptx> --out <dir> [--pages N] [--only-pages 2,4] | import <file.pptx> --out <工程目录> [--max-slides N]',
  }))
  process.exit(1)
}

function parseArgs(argv: string[]): Flags {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') usage()
  const flags: Flags = { command }
  const rest = argv.slice(1)
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (token === '--out') flags.out = rest[++i]
    else if (token === '--screenshot') flags.screenshot = rest[++i]
    else if (token === '--platform') {
      const value = rest[++i]
      if (value !== 'mac' && value !== 'win' && value !== 'linux') usage()
      flags.platform = value
    } else if (token === '--officecli') flags.officecli = rest[++i]
    else if (token === '--pages') flags.pages = Number(rest[++i])
    else if (token === '--max-slides') flags.maxSlides = Number(rest[++i])
    else if (token === '--only-pages') {
      const value = rest[++i]
      if (!value || !/^\d+(,\d+)*$/.test(value)) usage()
      flags.pageNumbers = value.split(',').map(Number)
    }
    else if (!token.startsWith('-') && !flags.file) flags.file = token
    else usage()
  }
  return flags
}

function emit(status: RenderStatus, body: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify({ status, ...body }))
  process.exit(code)
}

const flags = parseArgs(process.argv.slice(2))
if (flags.pageNumbers && flags.command !== 'screenshot') usage()
if (flags.command === 'import') {
  if (!flags.file || !flags.out) usage()
  try {
    const imported = await importPptxFile(resolve(flags.file), resolve(flags.out), { maxSlides: flags.maxSlides })
    const failed = !imported.deck
    const revision = revisionStatus(imported.issues)
    emit(failed ? 'error' : revision.status, {
      project: imported.projectDir,
      deck: imported.deck ? resolve(imported.projectDir, 'deck.json') : undefined,
      source: imported.source,
      pages: imported.deck?.pages.length ?? 0,
      issues: imported.issues,
      errorCount: revision.errorCount,
      warningCount: revision.warningCount,
      ...(revision.status === 'needs_revision' ? { message: formatNeedsRevision(resolve(flags.file!), imported.issues) } : {}),
      diagnostics: imported.diagnostics,
      preview: imported.preview,
    }, failed ? 1 : revision.code)
  } catch (error) {
    emit('error', { message: error instanceof Error ? error.message : String(error) }, 1)
  }
}
if (flags.command === 'layouts') {
  console.log(JSON.stringify({ status: 'ok', layouts: argumentLayoutCatalog() }))
  process.exit(0)
}
if (!flags.file) usage()
const file = resolve(flags.file)

if (flags.command === 'screenshot') {
  if (!flags.out) usage()
  const result = await captureSlides(file, resolve(flags.out), flags.pages && flags.pages > 0 ? flags.pages : 0, { officecli: flags.officecli, pageNumbers: flags.pageNumbers })
  emit(result.available ? 'ok' : 'error', { screenshots: result }, result.available ? 0 : 1)
}

const loaded = loadDeckFile(file)
if (!loaded.deck) emit('error', { issues: loaded.issues }, 1)

if (flags.command === 'check') {
  const issues = [...loaded.issues, ...checkDeck(loaded.deck)]
  const revision = revisionStatus(issues)
  emit(revision.status, {
    issues,
    pages: loaded.deck.pages.length,
    errorCount: revision.errorCount,
    warningCount: revision.warningCount,
    ...(revision.status === 'needs_revision' ? { message: formatNeedsRevision(file, issues) } : {}),
  }, revision.code)
}

if (flags.command === 'render') {
  if (!flags.out) usage()
  const result = await exportDeck(loaded.deck, resolve(flags.out), {
    platform: flags.platform ?? platformFromProcess(),
    screenshotDir: flags.screenshot ? resolve(flags.screenshot) : undefined,
    officecli: flags.officecli,
  })
  const retained = result.pptx ? loadRetained(file) : undefined
  if (result.pptx && retained) await mergeRetained(result.pptx, retained)
  emit(result.status, {
    issues: result.issues,
    pptx: result.pptx ? realpathSync(result.pptx) : undefined,
    screenshots: result.screenshots,
    pages: loaded.deck.pages.length,
  }, result.status === 'ok' ? 0 : 2)
}

usage()
