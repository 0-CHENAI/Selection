import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planProjectValidation } from './project-validation-plan'

test('project checks use existing scripts, share commands, and fall back to workspace checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-checks-'))
  try {
    mkdirSync(join(root, 'packages', 'app'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9', scripts: { typecheck: 'tsc', test: 'test runner', build: 'build' } }))
    writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ scripts: { build: 'build' } }))
    const result = planProjectValidation(root, ['packages/app/a.ts', 'packages/app/b.ts'])
    expect(result.uncovered).toEqual([])
    expect(result.checks).toEqual([{ cwd: realpathSync(root), script: 'typecheck', packageManager: 'pnpm' }, { cwd: realpathSync(root), script: 'test', packageManager: 'pnpm' }])
    expect(() => planProjectValidation(root, ['../escape.ts'])).toThrow('escapes')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unsupported projects remain explicitly uncovered instead of claiming validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-no-checks-'))
  try { expect(planProjectValidation(root, ['app.py'])).toEqual({ checks: [], uncovered: ['app.py'] }) }
  finally { rmSync(root, { recursive: true, force: true }) }
})
