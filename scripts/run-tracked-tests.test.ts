import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'

const runner = join(import.meta.dir, 'run-tracked-tests.sh')
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'tracked-tests-'))
  fixtures.push(root)
  const repo = join(root, 'repo')
  const bin = join(root, 'bin')
  const log = join(root, 'calls')
  mkdirSync(repo)
  mkdirSync(bin)
  writeFileSync(join(bin, 'bun'), '#!/bin/bash\nprintf "%s\\n" "${2##*/}" >> "$TEST_CALLS"\ncase "$2" in *fail*) exit 1 ;; esac\n', { mode: 0o755 })
  expect(spawnSync('git', ['init', '-q', repo]).status).toBe(0)
  writeFileSync(join(repo, '.gitignore'), 'ignored.test.ts\n')
  for (const name of ['0 untracked.test.ts', 'a fail.test.ts', 'b pass.test.ts', 'c fail.isolated.ts', 'd helper.fixture.ts', 'ignored.test.ts']) {
    writeFileSync(join(repo, name), '')
  }
  expect(spawnSync('git', ['add', '.gitignore', 'a fail.test.ts', 'b pass.test.ts', 'd helper.fixture.ts'], { cwd: repo }).status).toBe(0)
  return { repo, bin, log }
}

function run(fixture: ReturnType<typeof makeFixture>, ...args: string[]) {
  const result = spawnSync('bash', [runner, ...args], {
    cwd: fixture.repo,
    env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, TEST_CALLS: fixture.log },
    encoding: 'utf8',
  })
  return { ...result, calls: readFileSync(fixture.log, 'utf8').trim().split('\n') }
}

test('CI mode runs every tracked and untracked test, then reports all failures', () => {
  const result = run(makeFixture(), '--keep-going')
  expect(result.status).toBe(1)
  expect(result.calls).toEqual(['0 untracked.test.ts', 'a fail.test.ts', 'b pass.test.ts', 'c fail.isolated.ts'])
  expect(result.stderr).toContain('Failed test files (2):')
  expect(result.stderr).toContain('a fail.test.ts')
  expect(result.stderr).toContain('c fail.isolated.ts')
})

test('default mode stops at the first failure', () => {
  const result = run(makeFixture())
  expect(result.status).toBe(1)
  expect(result.calls).toEqual(['0 untracked.test.ts', 'a fail.test.ts'])
  expect(result.stderr).toContain('Failed test files (1):')
})

test('CI mode succeeds when no tests fail, including an empty isolated set', () => {
  const fixture = makeFixture()
  rmSync(join(fixture.repo, 'a fail.test.ts'))
  rmSync(join(fixture.repo, 'c fail.isolated.ts'))
  expect(spawnSync('git', ['rm', '--cached', 'a fail.test.ts'], { cwd: fixture.repo }).status).toBe(0)
  const result = run(fixture, '--keep-going')
  expect(result.status).toBe(0)
  expect(result.calls).toEqual(['0 untracked.test.ts', 'b pass.test.ts'])
})

test('the required validation check rejects failed or skipped parallel jobs', () => {
  const workflow = load(readFileSync(join(import.meta.dir, '../.github/workflows/validate.yml'), 'utf8')) as {
    jobs: { validate: { needs: string[], if: string, steps: { run: string }[] } }
  }
  const gate = workflow.jobs.validate
  expect(gate.needs).toEqual(['validation_checks', 'tracked_tests'])
  expect(gate.if).toContain('!cancelled()')
  const command = gate.steps[0].run as string
  for (const [checks, tests, expected] of [
    ['success', 'success', 0],
    ['failure', 'success', 1],
    ['success', 'failure', 1],
    ['success', 'skipped', 1],
  ] as const) {
    const result = spawnSync('bash', ['-c', command], {
      env: { ...process.env, CHECKS_RESULT: checks, TESTS_RESULT: tests },
    })
    expect(result.status).toBe(expected)
  }
})
