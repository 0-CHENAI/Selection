import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareIsolatedWorkspace, assertIsolatedTool } from './isolated-workspace'
test('Git snapshots preserve staged and unstaged input without mutating the user index', () => {
  const root = mkdtempSync(join(tmpdir(), 'isolation-')), repo = join(root, 'repo'), store = join(root, 'store')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  try {
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(join(repo, 'a.txt'), 'base'); git('add', '.'); git('commit', '-m', 'base')
    writeFileSync(join(repo, 'a.txt'), 'staged'); git('add', '.')
    writeFileSync(join(repo, 'a.txt'), 'unstaged'); writeFileSync(join(repo, 'new.txt'), 'untracked')
    const status = git('status', '--porcelain'), staged = git('diff', '--cached')
    const state = prepareIsolatedWorkspace(repo, store)
    expect(readFileSync(join(state.directory, 'a.txt'), 'utf8')).toBe('unstaged')
    expect(readFileSync(join(state.directory, 'new.txt'), 'utf8')).toBe('untracked')
    expect(git('status', '--porcelain')).toBe(status); expect(git('diff', '--cached')).toBe(staged)
    expect(() => assertIsolatedTool(state, 'Write', { file_path: join(repo, 'a.txt') })).toThrow()
    expect(() => assertIsolatedTool(state, 'Bash', { command: 'echo nope' })).toThrow('sandbox')
    expect(() => assertIsolatedTool(state, 'Write', { file_path: 'safe.txt' })).not.toThrow()
    symlinkSync(repo, join(state.directory, 'escape'))
    expect(() => assertIsolatedTool(state, 'Write', { file_path: 'escape/a.txt' })).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a repository subdirectory cannot snapshot isolation storage from its parent project', () => {
  const root = mkdtempSync(join(tmpdir(), 'isolation-nested-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  try {
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    mkdirSync(join(root, 'project'))
    writeFileSync(join(root, 'project', 'a.txt'), 'base')
    git('add', '.'); git('commit', '-m', 'base')
    expect(() => prepareIsolatedWorkspace(join(root, 'project'), join(root, 'storage'))).toThrow('outside the source repository')
    expect(readFileSync(join(root, 'project', 'a.txt'), 'utf8')).toBe('base')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
