import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { inside } from './isolated-workspace'
import { mergeCandidate } from './merge-candidate'
import { ProjectIntegration, type IntegrationChange } from './project-integration'
import { ArtifactConflict } from './artifact-versions'

export interface CandidateFile { path: string; base: Buffer | null; candidate: Buffer | null; binary?: boolean }
export interface CandidateValidation { passed: boolean; checks: string[] }
export type IntegrationResult =
  | { status: 'conflict'; files: Array<{ path: string; reason: string }> }
  | { status: 'validation-failed'; checks: string[] }
  | { status: 'unchanged'; checks: string[]; paths: string[]; hashes: Record<string, string | null> }
  | { status: 'integrated'; transactionId: string; checks: string[]; paths: string[]; hashes: Record<string, string | null> }

/**
 * Runtime-owned gate shared by coordinators: the validator receives merged
 * bytes, never a request to evaluate or trust an agent's completion claim.
 */
export async function integrateCandidates(options: {
  root: string; storage: string; files: CandidateFile[]
  validate: (files: ReadonlyArray<{ path: string; content: Buffer | null }>) => Promise<CandidateValidation>
  ensureAuthorized: () => void | Promise<void>
  verifyInputs?: () => void
  onPrepared?: (receipt: { transactionId: string; hashes: Record<string, string | null>; checks: string[] }) => void
}): Promise<IntegrationResult> {
  await options.ensureAuthorized()
  const root = realpathSync(options.root)
  const changes: IntegrationChange[] = []
  const mergedFiles: Array<{ path: string; content: Buffer | null }> = []
  const conflicts: Array<{ path: string; reason: string }> = []
  const seen = new Set<string>()
  const expected = new Map<string, string | null>()
  for (const file of options.files) {
    const target = resolve(root, file.path)
    if (!inside(root, target) || root === target || seen.has(target)) throw new Error('Invalid or duplicate candidate target')
    seen.add(target)
    let current: Buffer | null = null
    if (existsSync(target)) {
      if (!inside(root, realpathSync(target)) || !lstatSync(target).isFile()) throw new Error('Candidate target must be a regular project file')
      current = readFileSync(target)
    }
    expected.set(target, current === null ? null : createHash('sha256').update(current).digest('hex'))
    const merged = mergeCandidate(file.base, current, file.candidate, { binary: file.binary })
    if (merged.status === 'conflict') { conflicts.push({ path: file.path, reason: merged.reason }); continue }
    mergedFiles.push({ path: file.path, content: merged.status === 'deleted' ? null : merged.content })
    if (!merged.changed) continue
    changes.push({ path: file.path, expectedHash: current === null ? null : createHash('sha256').update(current).digest('hex'),
      content: merged.status === 'deleted' ? null : merged.content })
  }
  if (conflicts.length) return { status: 'conflict', files: conflicts }
  // Give the validator copies: validation must not mutate the approved bytes.
  const validation = await options.validate(mergedFiles.map(file => ({ path: file.path, content: file.content === null ? null : Buffer.from(file.content) })))
  if (!validation.passed) return { status: 'validation-failed', checks: validation.checks }
  await options.ensureAuthorized()
  for (const [target, hash] of expected) {
    let currentHash: string | null = null
    if (existsSync(target)) {
      if (!inside(root, realpathSync(target)) || !lstatSync(target).isFile()) throw new ArtifactConflict()
      currentHash = createHash('sha256').update(readFileSync(target)).digest('hex')
    }
    if (hash !== currentHash) throw new ArtifactConflict()
  }
  options.verifyInputs?.()
  // Bind receipts to the exact validated bytes, including unchanged outputs.
  const hashes = Object.fromEntries(mergedFiles.map(file => [file.path, file.content === null ? null : createHash('sha256').update(file.content).digest('hex')]))
  if (!changes.length) return { status: 'unchanged', checks: validation.checks, paths: mergedFiles.map(file => file.path), hashes }
  const transactionId = new ProjectIntegration(root, options.storage).apply(changes, undefined, transactionId => options.onPrepared?.({ transactionId, hashes, checks: validation.checks }))
  return { status: 'integrated', transactionId, checks: validation.checks, paths: changes.map(change => change.path), hashes }
}
