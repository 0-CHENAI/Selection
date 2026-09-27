import { createHash } from 'node:crypto'
import { acquireProjectLock } from './project-lock'
import { createIsolatedShell } from '../../../shared/src/utils/isolated-shell'
import { closeSync, mkdirSync, openSync, realpathSync, readFileSync, writeSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { inside } from './isolated-workspace'
import type { ProjectValidationPlan, ProjectCheck } from './project-validation-plan'

export interface ProjectCheckResult { script: string; directory: string; passed: boolean; exitCode: number | null; logPath: string }
/** Execution is authorized separately; a working directory is not a security sandbox. */
export interface ProjectValidationOptions {
  plan: ProjectValidationPlan; baselineRoot: string; candidateRoot: string; logDirectory: string
  projectRoot: string; lockDirectory: string
  signal?: AbortSignal; ensureAuthorized: () => void | Promise<void>
  executable?: Partial<Record<ProjectCheck['packageManager'], string>>
}
export async function runProjectValidation(options: ProjectValidationOptions): Promise<{ passed: boolean; results: ProjectCheckResult[]; uncovered: string[] }> {
  options.signal?.throwIfAborted()
  await options.ensureAuthorized()
  options.signal?.throwIfAborted()
  const project = realpathSync(options.projectRoot)
  if (inside(project, resolve(options.lockDirectory))) throw new Error('Validation locks must be outside the source project')
  const release = acquireProjectLock(join(options.lockDirectory, createHash('sha256').update(project).digest('hex')))
  try { return await runLockedProjectValidation(options) } finally { release() }
}

async function runLockedProjectValidation(options: ProjectValidationOptions): Promise<{ passed: boolean; results: ProjectCheckResult[]; uncovered: string[] }> {
  const baseline = realpathSync(options.baselineRoot), candidate = realpathSync(options.candidateRoot)
  if (baseline === candidate || inside(baseline, candidate) || inside(candidate, baseline)) throw new Error('Project checks require a separate candidate workspace')
  if (options.plan.uncovered.length || !options.plan.checks.length) return { passed: false, results: [], uncovered: options.plan.uncovered }
  mkdirSync(options.logDirectory, { recursive: true })
  const results: ProjectCheckResult[] = []
  for (const [index, check] of options.plan.checks.entries()) {
    options.signal?.throwIfAborted()
    await options.ensureAuthorized()
    options.signal?.throwIfAborted()
    if (!inside(baseline, resolve(check.cwd)) || !['typecheck', 'lint', 'test'].includes(check.script)) throw new Error('Invalid project check')
    const cwd = realpathSync(resolve(candidate, relative(baseline, check.cwd)))
    if (!inside(candidate, cwd)) throw new Error('Project check directory escapes candidate')
    const baselineScripts = JSON.parse(readFileSync(join(check.cwd, 'package.json'), 'utf8')).scripts
    const candidateScripts = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).scripts
    if (JSON.stringify(baselineScripts) !== JSON.stringify(candidateScripts)) throw new Error('Project validation scripts changed; review the validation configuration first')
    const logPath = join(options.logDirectory, `check-${index}.log`)
    const fd = openSync(logPath, 'wx', 0o600)
    let exitCode: number | null
    try {
      const shell = createIsolatedShell(candidate)
      if (!shell) throw new Error('Native confinement is unavailable; project checks require a supported isolated execution environment')
      try {
        const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
        const executable = options.executable?.[check.packageManager] ?? check.packageManager
        const command = [executable, 'run', check.script].map(quote).join(' ')
        exitCode = (await shell.operations.exec(command, cwd, { signal: options.signal, onData: bytes => { writeSync(fd, bytes) } })).exitCode
      } finally { shell.dispose() }
    } finally { closeSync(fd) }
    options.signal?.throwIfAborted()
    await options.ensureAuthorized()
    options.signal?.throwIfAborted()
    results.push({ script: check.script, directory: relative(baseline, check.cwd) || '.', passed: exitCode === 0, exitCode, logPath })
    if (exitCode !== 0) return { passed: false, results, uncovered: [] }
  }
  return { passed: true, results, uncovered: [] }
}
