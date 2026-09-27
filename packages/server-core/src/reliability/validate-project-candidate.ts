import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { atomicWrite } from './artifact-versions'
import { assertIsolatedTool, prepareIsolatedWorkspace, disposeIsolatedWorkspace } from './isolated-workspace'
import { planProjectValidation } from './project-validation-plan'
import { runProjectValidation, type ProjectValidationOptions } from './project-validation-runner'
import type { CandidateValidation } from './integrate-candidates'

/** Validate the exact merged bytes in snapshots, preserving both source and worker. */
export async function validateProjectCandidate(options: {
  sourceRoot: string; storage: string; files: ReadonlyArray<{ path: string; content: Buffer | null }>
  declaredInputs?: string[]
  ensureAuthorized: () => void | Promise<void>; signal?: AbortSignal
  executable?: ProjectValidationOptions['executable']
}): Promise<CandidateValidation> {
  await options.ensureAuthorized(); options.signal?.throwIfAborted()
  const baseline = prepareIsolatedWorkspace(options.sourceRoot, join(options.storage, 'baselines'), options.declaredInputs)
  if (baseline.kind !== 'git' && !options.declaredInputs?.length) return { passed: false, checks: ['Project validation requires declared inputs including the project checks'] }
  const candidate = prepareIsolatedWorkspace(baseline.directory, join(options.storage, 'candidates'), Object.keys(baseline.inputs))
  const expected = new Map<string, string>()
  for (const file of options.files) {
    if (file.content === null) return { passed: false, checks: ['Declared output is missing'] }
    assertIsolatedTool(candidate, 'write', { path: file.path })
    const path = resolve(candidate.directory, file.path)
    atomicWrite(path, file.content)
    expected.set(path, createHash('sha256').update(file.content).digest('hex'))
  }
  const plan = planProjectValidation(baseline.directory, options.files.map(file => file.path))
  const git = (args: string[]) => execFileSync('git', args, { cwd: candidate.directory, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: Infinity })
  const revision = baseline.kind === 'git' ? git(['rev-parse', 'HEAD']).toString().trim() : undefined
  // Checks may generate ignored reports, but changing tracked project inputs
  // would validate a different project than the one we are about to apply.
  const trackedFingerprint = () => {
    if (revision) return createHash('sha256').update(git(['diff', '--no-ext-diff', '--no-textconv', '--binary', revision, '--', ':/'])).digest('hex')
    const hash = createHash('sha256')
    for (const path of Object.keys(baseline.inputs).sort()) {
      assertIsolatedTool(candidate, 'write', { path })
      hash.update(JSON.stringify([path, createHash('sha256').update(readFileSync(resolve(candidate.directory, path))).digest('hex')]))
    }
    return hash.digest('hex')
  }
  const expectedProject = trackedFingerprint()
  let result: Awaited<ReturnType<typeof runProjectValidation>>
  try {
    result = await runProjectValidation({ plan, baselineRoot: baseline.directory, candidateRoot: candidate.directory,
    projectRoot: realpathSync(options.sourceRoot), lockDirectory: join(options.storage, 'locks'), logDirectory: join(options.storage, 'logs', randomUUID()),
    ensureAuthorized: options.ensureAuthorized, signal: options.signal, executable: options.executable })
  } catch (error) {
    // Cancellation and revoked authorization remain terminal control signals.
    options.signal?.throwIfAborted()
    await options.ensureAuthorized()
    options.signal?.throwIfAborted()
    return { passed: false, checks: [`Project validation could not complete: ${error instanceof Error ? error.message : 'unknown error'}`] }
  }
  const checks = result.results.map(item => `${item.script}: ${item.passed ? 'passed' : `failed (${item.exitCode})`} — ${item.logPath}`)
  if (result.uncovered.length) checks.push(`No project checks for: ${result.uncovered.join(', ')}`)
  if (!result.passed) return { passed: false, checks }
  if ((revision && git(['rev-parse', 'HEAD']).toString().trim() !== revision) || trackedFingerprint() !== expectedProject) {
    return { passed: false, checks: [...checks, 'Project checks modified tracked inputs; validation must be repeated'] }
  }
  for (const [path, hash] of expected) {
    assertIsolatedTool(candidate, 'write', { path })
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) return { passed: false, checks: [...checks, 'Project checks modified the candidate; validation must be repeated'] }
  }
  // These snapshots are disposable only after successful verification. Failed
  // runs keep their files and logs so the task can inspect and repair them.
  disposeIsolatedWorkspace(candidate, join(options.storage, 'candidates'))
  disposeIsolatedWorkspace(baseline, join(options.storage, 'baselines'))
  return { passed: true, checks }
}
