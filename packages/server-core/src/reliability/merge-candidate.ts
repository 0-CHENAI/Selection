import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CandidateMerge =
  | { status: 'merged'; content: Buffer; changed: boolean }
  | { status: 'conflict'; reason: 'binary' | 'text' | 'delete-modify' | 'add-add'; candidate: Buffer | null; current: Buffer | null }

function text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true } catch { return false }
}

/** Pure integration decision: never writes the destination, never resolves conflicts with a model. */
export function mergeCandidate(base: Buffer | null, current: Buffer | null, candidate: Buffer | null, options: { binary?: boolean } = {}): CandidateMerge | { status: 'deleted'; changed: boolean } {
  const equal = (a: Buffer | null, b: Buffer | null) => a === null ? b === null : b !== null && a.equals(b)
  const accepted = (value: Buffer | null, changed: boolean): CandidateMerge | { status: 'deleted'; changed: boolean } =>
    value === null ? { status: 'deleted', changed } : { status: 'merged', content: value, changed }
  if (equal(current, candidate)) return accepted(current, false)
  if (equal(base, candidate)) return accepted(current, false)
  if (equal(base, current)) return accepted(candidate, true)
  if (base === null) return { status: 'conflict', reason: 'add-add', candidate, current }
  if (current === null || candidate === null) return { status: 'conflict', reason: 'delete-modify', candidate, current }
  if (options.binary || ![base, current, candidate].every(text)) return { status: 'conflict', reason: 'binary', candidate, current }

  const directory = mkdtempSync(join(tmpdir(), 'selection-merge-'))
  try {
    const paths = ['current', 'base', 'candidate'].map(name => join(directory, name))
    for (const [index, content] of [current, base, candidate].entries()) writeFileSync(paths[index]!, content, { mode: 0o600 })
    const result = spawnSync('git', ['merge-file', '--stdout', '--', ...paths], { encoding: 'buffer', maxBuffer: Math.max(1024 * 1024, (base.length + current.length + candidate.length) * 3), env: { ...process.env, LC_ALL: 'C' } })
    if (result.error) throw result.error
    if (result.status === 0) return { status: 'merged', content: result.stdout, changed: !result.stdout.equals(current) }
    if (result.status !== null && result.status > 0 && result.status <= 127) return { status: 'conflict', reason: 'text', candidate, current }
    throw new Error(`Three-way merge failed (${result.status ?? result.signal ?? 'unknown'})`)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
