import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { inside } from './isolated-workspace'

export interface ProjectCheck { cwd: string; script: string; packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn' }
export interface ProjectValidationPlan { checks: ProjectCheck[]; uncovered: string[] }

/** Discover existing checks from the frozen input, never from model-edited scripts. */
export function planProjectValidation(root: string, changedPaths: readonly string[]): ProjectValidationPlan {
  const base = realpathSync(root)
  const checks = new Map<string, ProjectCheck>()
  const uncovered: string[] = []
  for (const changed of changedPaths) {
    const target = resolve(base, changed)
    if (!inside(base, target) || target === base) throw new Error('Validation input escapes project')
    let directory = dirname(target)
    let covered = false
    while (inside(base, directory)) {
      const manifest = join(directory, 'package.json')
      if (existsSync(manifest)) {
        if (!inside(base, realpathSync(manifest))) throw new Error('Validation manifest escapes project')
        const value = JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, unknown>; packageManager?: string }
        const manager = value.packageManager?.split('@')[0]
        const packageManager = manager && ['bun', 'npm', 'pnpm', 'yarn'].includes(manager) ? manager as ProjectCheck['packageManager']
          : existsSync(join(directory, 'bun.lock')) || existsSync(join(directory, 'bun.lockb')) ? 'bun'
          : existsSync(join(directory, 'pnpm-lock.yaml')) ? 'pnpm'
          : existsSync(join(directory, 'yarn.lock')) ? 'yarn' : 'npm'
        for (const script of ['typecheck', 'lint', 'test']) {
          if (typeof value.scripts?.[script] !== 'string' || !value.scripts[script].trim()) continue
          checks.set(JSON.stringify([directory, script]), { cwd: directory, script, packageManager })
          covered = true
        }
        if (covered) break
      }
      if (directory === base) break
      directory = dirname(directory)
    }
    if (!covered) uncovered.push(changed)
  }
  return { checks: [...checks.values()], uncovered }
}
