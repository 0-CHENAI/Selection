import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { argumentLayoutCatalog } from './argument-layouts.ts'
import { checkDeck, formatNeedsRevision, revisionStatus } from './check.ts'
import { exportDeck, platformFromProcess } from './export-pptx.ts'
import { deckFileStamp, waitForHostOutput } from './host-output.ts'
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
  waitForExport?: boolean
}

function usage(): never {
  console.log(JSON.stringify({
    status: 'error',
    message: '用法：deck-cli.mjs layouts | check <deck.json> [--wait-for-export] | render <deck.json> --out <file.pptx> [--screenshot <dir>] [--platform mac|win|linux] | screenshot <file.pptx> --out <dir> [--pages N] [--only-pages 2,4] | import <file.pptx> --out <工程目录> [--max-slides N]',
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
    else if (token === '--wait-for-export') flags.waitForExport = true
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
if (flags.waitForExport && flags.command !== 'check') usage()
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
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const bytes = readFileSync(file)
  const before = hash(bytes)
  const scratch = mkdtempSync(join(tmpdir(), 'selection-ppt-screenshot-'))
  const snapshot = join(scratch, basename(file))
  const result = await (async () => {
    try {
      // OfficeCLI can serve the original path from a resident's memory instead of from disk.
      writeFileSync(snapshot, bytes, { mode: 0o600 })
      process.env.OFFICECLI_NO_AUTO_RESIDENT = '1'
      return await captureSlides(snapshot, resolve(flags.out!), flags.pages && flags.pages > 0 ? flags.pages : 0, { officecli: flags.officecli, pageNumbers: flags.pageNumbers })
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })()
  const pages = flags.pageNumbers ? [...new Set(flags.pageNumbers)].sort((a, b) => a - b) : result.files.map((_, index) => index + 1)
  const pptVisualRender = result.available && result.files.length && hash(readFileSync(file)) === before
    ? { path: realpathSync(file), sha256: before, pages: result.files.map((path, index) => ({ page: pages[index], path, sha256: hash(readFileSync(path)) })) }
    : undefined
  if (pptVisualRender && process.env.CRAFT_SESSION_DIR) {
    const dir = join(process.env.CRAFT_SESSION_DIR, 'data', 'ppt-visual-renders')
    const receipt = join(dir, `${Date.now()}-${randomUUID()}.json`)
    const partial = receipt + '.tmp'
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(partial, JSON.stringify(pptVisualRender), { mode: 0o600 })
      renameSync(partial, receipt)
    } catch {
      try { rmSync(partial, { force: true }) } catch { /* The render is still available on stdout. */ }
    }
  }
  emit(result.available ? 'ok' : 'error', { screenshots: result, pptVisualRender }, result.available ? 0 : 1)
}

let stamp: string | undefined
if (flags.waitForExport) {
  try { stamp = deckFileStamp(file) } catch { /* loadDeckFile reports unreadable sources */ }
}
const loaded = loadDeckFile(file)
if (!loaded.deck) emit('error', { issues: loaded.issues }, 1)

if (flags.command === 'check') {
  const issues = [...loaded.issues, ...checkDeck(loaded.deck)]
  const revision = revisionStatus(issues)
  let pptx: string | undefined
  if (flags.waitForExport && revision.status === 'ok') {
    try {
      pptx = await waitForHostOutput(file, stamp ?? '')
    } catch (error) {
      emit('error', { issues, message: error instanceof Error ? error.message : String(error) }, 1)
    }
  }
  emit(revision.status, {
    ...(pptx ? { pptx } : {}),
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
