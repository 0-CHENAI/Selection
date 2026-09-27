import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateProjectCandidate } from './validate-project-candidate'

test('project validator checks merged bytes while preserving the original dirty workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merged-validation-')), source = join(root, 'source'); mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  try {
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(join(source, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
    writeFileSync(join(source, 'check.ts'), `import { readFileSync } from 'node:fs'; if (readFileSync('a.ts', 'utf8') !== 'merged') process.exit(1);`)
    writeFileSync(join(source, 'a.ts'), 'base'); git('add', '.'); git('commit', '-m', 'base')
    writeFileSync(join(source, 'a.ts'), 'user edit')
    const result = await validateProjectCandidate({ sourceRoot: source, storage: join(root, 'validation'), files: [{ path: 'a.ts', content: Buffer.from('merged') }], ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(result.passed).toBe(true)
    expect(result.checks[0]).toContain('passed')
    expect(readFileSync(join(source, 'a.ts'), 'utf8')).toBe('user edit')
    expect(git('diff', '--', 'a.ts').toString()).toContain('+user edit')
    expect(git('worktree', 'list', '--porcelain').toString().match(/^worktree /gm)).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const tracked of [true, false]) test(`project checks cannot silently change tracked dependencies (tracked=${tracked})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'validation-inputs-')), source = join(root, 'source'); mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  try {
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(join(source, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
    const target = tracked ? 'dependency.ts' : 'coverage.txt'
    writeFileSync(join(source, 'check.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(target)}, 'changed by test');`)
    writeFileSync(join(source, 'a.ts'), 'base')
    writeFileSync(join(source, 'dependency.ts'), 'original dependency')
    writeFileSync(join(source, '.gitignore'), 'coverage.txt\n')
    git('add', '.'); git('commit', '-m', 'base')
    const result = await validateProjectCandidate({ sourceRoot: source, storage: join(root, 'validation'), files: [{ path: 'a.ts', content: Buffer.from('merged') }], ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(result.passed).toBe(!tracked)
    if (tracked) expect(result.checks.at(-1)).toContain('modified tracked inputs')
    expect(readFileSync(join(source, 'dependency.ts'), 'utf8')).toBe('original dependency')
    expect(readFileSync(join(source, 'a.ts'), 'utf8')).toBe('base')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unavailable check executable returns a retained validation failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'validation-launch-')), source = join(root, 'source'); mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  try {
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(join(source, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'echo checked' } }))
    writeFileSync(join(source, 'a.ts'), 'base'); git('add', '.'); git('commit', '-m', 'base')
    const result = await validateProjectCandidate({ sourceRoot: source, storage: join(root, 'validation'), files: [{ path: 'a.ts', content: Buffer.from('merged') }], ensureAuthorized: () => {}, executable: { bun: join(root, 'missing-executable') } })
    expect(result.passed).toBe(false)
    // Native confinement launches Bash; a missing command exits 127 rather than throwing spawn ENOENT.
    expect(result.checks[0]).toContain('failed (127)')
    expect(readFileSync(join(source, 'a.ts'), 'utf8')).toBe('base')
    expect(git('worktree', 'list', '--porcelain').toString().match(/^worktree /gm)).toHaveLength(3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const includeCheck of [true, false]) test(`non-Git validation copies declared inputs only (check declared=${includeCheck})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nongit-validation-')), source = join(root, 'source'); mkdirSync(source)
  try {
    writeFileSync(join(source, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
    writeFileSync(join(source, 'check.ts'), `import { existsSync, readFileSync } from 'node:fs'; if (existsSync('private.txt') || readFileSync('a.ts', 'utf8') !== 'merged') process.exit(1);`)
    writeFileSync(join(source, 'a.ts'), 'base')
    writeFileSync(join(source, 'private.txt'), 'undeclared data')
    const result = await validateProjectCandidate({ sourceRoot: source, storage: join(root, 'validation'), declaredInputs: ['package.json', 'a.ts', ...(includeCheck ? ['check.ts'] : [])], files: [{ path: 'a.ts', content: Buffer.from('merged') }], ensureAuthorized: () => {}, executable: { bun: process.execPath } })
    expect(result.passed).toBe(includeCheck)
    expect(readFileSync(join(source, 'a.ts'), 'utf8')).toBe('base')
    expect(readFileSync(join(source, 'private.txt'), 'utf8')).toBe('undeclared data')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
