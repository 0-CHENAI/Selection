/**
 * Host record of native visual checks. The model reads the images; this file only remembers which pages were rendered.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const VISUAL_QA_ROUND_LIMIT = 3

export interface VisualPageRecord {
  label: string
  sha256: string
}

export interface VisualRound {
  at: string
  renderer: string
  file: string
  pages: VisualPageRecord[]
}

interface VisualLog {
  rounds: VisualRound[]
}

function logPath(sessionDir: string): string {
  return join(sessionDir, 'data', 'visual-qa.json')
}

function readLog(sessionDir: string): VisualLog {
  try {
    const parsed = JSON.parse(readFileSync(logPath(sessionDir), 'utf8')) as VisualLog
    return Array.isArray(parsed.rounds) ? { rounds: parsed.rounds.slice(-12) } : { rounds: [] }
  } catch {
    return { rounds: [] }
  }
}

export function recordVisualInspection(sessionDir: string, file: string, renderer: string, images: Array<{ label: string; path?: string; bytes?: Uint8Array }>): { rounds: number; atLimit: boolean } {
  const pages: VisualPageRecord[] = images.map(image => {
    const bytes = image.bytes ?? (image.path && existsSync(image.path) ? readFileSync(image.path) : new Uint8Array())
    return { label: image.label, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  const log = readLog(sessionDir)
  const prior = log.rounds.filter(round => round.file === file).length
  log.rounds.push({ at: new Date().toISOString(), renderer, file, pages })
  mkdirSync(join(sessionDir, 'data'), { recursive: true })
  writeFileSync(logPath(sessionDir), `${JSON.stringify(log, null, 2)}\n`)
  const rounds = prior + 1
  return { rounds, atLimit: rounds >= VISUAL_QA_ROUND_LIMIT }
}
