import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir, devNull } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v3'
import { runGitHubRepositoryAction } from '../../packages/server-core/src/services/github-repository'
import { pushInput } from '../../packages/session-tools-core/src/github-repository-protocol'
import { isGitHubShellWrite } from '../../packages/session-tools-core/src/runtime/github-shell'
import { publishBundle } from './publish'

test('commit staged files with the bot identity, publish exact hashes and reject a stale push', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selection-git-test-'))
  const checkout = join(dir, 'checkout')
  const remote = join(dir, 'remote')
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull },
  }).trim()
  try {
    await mkdir(checkout)
    git(dir, 'init', '--bare', remote)
    git(checkout, 'init', '-b', 'main')
    git(checkout, 'config', 'user.name', 'Personal user')
    git(checkout, 'config', 'user.email', 'personal@example.com')
    git(remote, 'config', 'uploadpack.allowFilter', 'true')
    await writeFile(join(checkout, 'unchanged'), 'existing repository content')
    git(checkout, 'add', 'unchanged')
    git(checkout, 'commit', '-m', 'initial')
    const unchangedBlob = git(checkout, 'rev-parse', 'HEAD:unchanged')
    const baseSha = git(checkout, 'rev-parse', 'HEAD')
    git(checkout, 'push', remote, 'HEAD:refs/heads/main')
    git(checkout, 'switch', '-c', 'feature/test')
    git(checkout, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    expect(isGitHubShellWrite([['git', 'commit', '-m', 'update']], checkout)).toBe(true)
    expect(isGitHubShellWrite([['git', 'push', 'origin', 'feature/test']], checkout)).toBe(true)
    expect(isGitHubShellWrite([['git', 'log']], checkout)).toBe(false)
    await writeFile(join(checkout, 'staged'), Buffer.from([0, 1, 2]))
    await writeFile(join(checkout, 'untracked'), 'local only')
    git(checkout, 'add', 'staged')
    let expected: string | null = null
    const name = 'selection-test[bot]'
    const email = '123+selection-test[bot]@users.noreply.github.com'
    const request = async <T>(route: string, schema: z.ZodType<T>, args: object): Promise<T> => {
      if (route === '/identity') return schema.parse({ name, email })
      if (route === '/branch') return schema.parse({ expected, baseSha: expected ?? baseSha })
      expect(route).toBe('/push')
      const bare = await mkdtemp(join(dir, 'broker-'))
      const result = await publishBundle(pushInput.parse(args), bare, remote, async (...args) => git(bare, ...args))
      expect(git(bare, 'rev-list', '--objects', '--missing=print', 'refs/selection/base')).toContain('?' + unchangedBlob)
      return schema.parse(result)
    }
    const repository = 'owner/repo'
    const push = () => runGitHubRepositoryAction({ repository, action: 'push' }, checkout, request)
    const commit = () => runGitHubRepositoryAction({ repository, action: 'commit', message: '以机器人身份提交' }, checkout, request)
    await expect(runGitHubRepositoryAction({ repository: 'other/repo', action: 'commit', message: 'x' }, checkout, request)).rejects.toThrow('origin')
    await commit()
    const first = git(checkout, 'rev-parse', 'HEAD')
    expect(git(checkout, 'show', '-s', '--format=%an|%ae|%cn|%ce')).toBe([name, email, name, email].join('|'))
    expect(git(checkout, 'ls-tree', '--name-only', 'HEAD')).toBe('staged\nunchanged')
    expect(git(remote, 'branch', '--format=%(refname:short)')).toBe('main')
    await push()
    expect(git(remote, 'rev-parse', 'feature/test')).toBe(first)
    await writeFile(join(checkout, 'second'), 'two')
    git(checkout, 'add', 'second')
    await commit()
    await expect(push()).rejects.toThrow()
    expect(git(remote, 'rev-parse', 'feature/test')).toBe(first)
    expected = first
    await push()
    expect(git(remote, 'rev-parse', 'feature/test')).toBe(git(checkout, 'rev-parse', 'HEAD'))
    expect(git(remote, 'rev-parse', 'main')).toBe(baseSha)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
