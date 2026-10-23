import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkDeck } from './check.ts'
import { exportDeck, platformFromProcess } from './export-pptx.ts'
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
}

function usage(): never {
  console.log(JSON.stringify({
    status: 'error',
    message: '用法：deck-cli.mjs check <deck.json> | render <deck.json> --out <file.pptx> [--screenshot <dir>] [--platform mac|win|linux] | screenshot <file.pptx> --out <dir> [--pages N]',
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
if (!flags.file) usage()
const file = resolve(flags.file)

if (flags.command === 'screenshot') {
  if (!flags.out) usage()
  const result = await captureSlides(file, resolve(flags.out), flags.pages && flags.pages > 0 ? flags.pages : 0, { officecli: flags.officecli })
  emit(result.available ? 'ok' : 'error', { screenshots: result }, result.available ? 0 : 1)
}

const loaded = loadDeckFile(file)
if (!loaded.deck) emit('error', { issues: loaded.issues }, 1)

if (flags.command === 'check') {
  const issues = [...loaded.issues, ...checkDeck(loaded.deck)]
  emit(issues.length ? 'needs_revision' : 'ok', { issues, pages: loaded.deck.pages.length }, issues.length ? 2 : 0)
}

if (flags.command === 'render') {
  if (!flags.out) usage()
  const result = await exportDeck(loaded.deck, resolve(flags.out), {
    platform: flags.platform ?? platformFromProcess(),
    screenshotDir: flags.screenshot ? resolve(flags.screenshot) : undefined,
    officecli: flags.officecli,
  })
  emit(result.status, {
    issues: result.issues,
    pptx: result.pptx ? realpathSync(result.pptx) : undefined,
    screenshots: result.screenshots,
    pages: loaded.deck.pages.length,
  }, result.status === 'ok' ? 0 : 2)
}

usage()
