import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planProjectValidation } from './project-validation-plan'
import { runProjectValidation } from './project-validation-runner'

test('project checks execute in candidate, retain logs, and stop after a failed check', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-runner-')), baseline = join(root, 'base'), candidate = join(root, 'candidate')
  mkdirSync(baseline); mkdirSync(candidate)
  writeFileSync(join(baseline, 'kept'), 'original')
  const manifest = { packageManager: 'bun@1', scripts: { typecheck: 'echo checked', lint: 'printf broken > ../base/kept; exit 7', test: 'echo must-not-run' } }
  writeFileSync(join(baseline, 'package.json'), JSON.stringify(manifest)); writeFileSync(join(candidate, 'package.json'), JSON.stringify(manifest))
  try {
    const result = await runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'),
      candidateRoot: candidate, logDirectory: join(root, 'logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(readFileSync(join(baseline, 'kept'), 'utf8')).toBe('original')
    expect(result.passed).toBe(false); expect(result.results.map(item => item.script)).toEqual(['typecheck', 'lint'])
    expect(readFileSync(result.results[0]!.logPath, 'utf8')).toContain('checked')
    expect(result.results[1]!.exitCode).toBe(7)
    writeFileSync(join(candidate, 'package.json'), JSON.stringify({ scripts: { test: 'echo bypass' } }))
    await expect(runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'), candidateRoot: candidate, logDirectory: join(root, 'changed-logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath } })).rejects.toThrow('scripts changed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cancellation terminates the validation process group before returning', async () => {
  const { existsSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'project-cancel-')), baseline = join(root, 'base'), candidate = join(root, 'candidate')
  mkdirSync(baseline); mkdirSync(candidate)
  const manifest = { packageManager: 'bun@1', scripts: { test: 'bun run worker.ts' } }
  writeFileSync(join(baseline, 'package.json'), JSON.stringify(manifest)); writeFileSync(join(candidate, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(candidate, 'worker.ts'), `import { appendFileSync } from 'node:fs'; setInterval(() => appendFileSync('heartbeat', 'x'), 5);`)
  const controller = new AbortController()
  try {
    const pending = runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'),
      candidateRoot: candidate, logDirectory: join(root, 'logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath }, signal: controller.signal })
    const settled = pending.then(() => 'completed', () => 'cancelled')
    const heartbeat = join(candidate, 'heartbeat')
    for (let i = 0; i < 100 && !existsSync(heartbeat); i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(existsSync(heartbeat)).toBe(true)
    await expect(runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'), candidateRoot: candidate, logDirectory: join(root, 'other-logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath } })).rejects.toThrow()
    controller.abort()
    expect(await settled).toBe('cancelled')
    const stopped = readFileSync(heartbeat, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readFileSync(heartbeat, 'utf8')).toBe(stopped)
    const completedManifest = JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'echo resumed' } })
    writeFileSync(join(baseline, 'package.json'), completedManifest); writeFileSync(join(candidate, 'package.json'), completedManifest)
    const resumed = await runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'), candidateRoot: candidate, logDirectory: join(root, 'resumed-logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(resumed.passed).toBe(true)
  } finally { controller.abort(); rmSync(root, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('successful launcher cannot leave background writers in its process group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-background-')), baseline = join(root, 'base'), candidate = join(root, 'candidate')
  mkdirSync(baseline); mkdirSync(candidate)
  const manifest = JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run launcher.ts' } })
  writeFileSync(join(baseline, 'package.json'), manifest); writeFileSync(join(candidate, 'package.json'), manifest)
  writeFileSync(join(candidate, 'worker.ts'), `import { appendFileSync } from 'node:fs'; appendFileSync('heartbeat', 'x'); setInterval(() => appendFileSync('heartbeat', 'x'), 5);`)
  writeFileSync(join(candidate, 'launcher.ts'), `import { spawn } from 'node:child_process'; import { existsSync } from 'node:fs'; const child = spawn(process.execPath, ['worker.ts'], { stdio: 'ignore' }); child.unref(); while (!existsSync('heartbeat')) await new Promise(r => setTimeout(r, 5)); process.exit(0);`)
  try {
    const result = await runProjectValidation({ plan: planProjectValidation(baseline, ['a.ts']), baselineRoot: baseline, projectRoot: baseline, lockDirectory: join(root, 'locks'), candidateRoot: candidate, logDirectory: join(root, 'logs'), ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(result.passed).toBe(true)
    const stopped = readFileSync(join(candidate, 'heartbeat'), 'utf8')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(readFileSync(join(candidate, 'heartbeat'), 'utf8')).toBe(stopped)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
