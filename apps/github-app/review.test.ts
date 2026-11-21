import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appPrivateKey, createGitHubAppHandler } from './server'
import { PublishError, publishBranch, publishFailure } from './publish'
import { isGitHubShellWrite, githubRepositoryFromUrl } from '../../packages/session-tools-core/src/runtime/github-shell'
import { runGitHubRepositoryAction } from '../../packages/server-core/src/services/github-repository'
import { runPreToolUseChecks, type PreToolUseInput } from '../../packages/shared/src/agent/core/pre-tool-use'
import { i18n, setupI18n } from '../../packages/shared/src/i18n'
import { extractSimpleCommandsStrict } from '../../packages/shared/src/agent/bash-validator'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const config = { clientId: 'test', clientSecret: 'secret', slug: 'test', privateKey: pem }
const sha = 'a'.repeat(40)
const input = { repository: 'owner/repo', head: 'feature', baseSha: sha, expected: sha, tip: sha, bundle: '' }

test('GitHub block reasons retain English guidance before i18n initialization', () => {
  const initialized = i18n.isInitialized
  i18n.isInitialized = false
  try {
    expect(runPreToolUseChecks({
      toolName: 'Bash', input: { command: 'gh issue create' },
    } as PreToolUseInput)).toEqual({
      type: 'block',
      reason: 'Use github_issue or github_repository to act as the GitHub App bot. If GitHub is not connected, connect it under Settings → External connections.',
    })
  } finally { i18n.isInitialized = initialized }
})

test('GitHub block reasons follow the current language at invocation time', async () => {
  setupI18n()
  const previous = i18n.language
  const reason = () => runPreToolUseChecks({
    toolName: 'Bash', input: { command: 'gh issue create' },
  } as PreToolUseInput)
  try {
    await i18n.changeLanguage('en')
    expect(reason()).toEqual({ type: 'block', reason: i18n.t('errors.githubAppWriteRequired') })
    expect((reason() as { reason: string }).reason).toContain('Use github_issue')
    await i18n.changeLanguage('zh-Hans')
    expect((reason() as { reason: string }).reason).toContain('请使用 github_issue')
  } finally { await i18n.changeLanguage(previous) }
})

test('routes GitHub hosts even when their repository path cannot be parsed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selection-host-routing-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  try {
    git('init')
    git('remote', 'add', 'origin', 'https://example.com/owner/repo.git')
    git('config', 'url.https://proxy.test/github/.insteadOf', 'https://github.com/')
    for (const path of ['%6f/r.git', '%ZZ/r.git', 'owner/repo/extra', '', 'owner/repo?query=1']) {
      const url = 'https://github.com/' + path
      git('remote', 'set-url', 'origin', url)
      expect(isGitHubShellWrite([['git', 'push', 'origin']], dir)).toBe(true)
      expect(isGitHubShellWrite([['git', 'push', url]], dir)).toBe(true)
      expect(isGitHubShellWrite([['git', 'push', 'https://proxy.test/github/' + path]], dir)).toBe(true)
    }
    expect(githubRepositoryFromUrl('https://github.com/%6f/r.git')).toBe('o/r')
    expect(githubRepositoryFromUrl('https://github.com/%ZZ/r.git')).toBeUndefined()
    expect(githubRepositoryFromUrl('https://github.com.example.com/%6f/r.git')).toBeUndefined()
    git('remote', 'set-url', 'origin', 'https://github.com.example.com/%6f/r.git')
    expect(isGitHubShellWrite([['git', 'push', 'origin']], dir)).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('accepts GitHub origins with ports and credentials on both routing paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selection-origin-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  try {
    git('init', '-b', 'main')
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    for (const remote of [
      'git@github.com:owner/repo.git', 'ssh://git@github.com:22/owner/repo.git',
      'https://user@github.com/owner/repo.git', 'https://x-access-token:test-password@github.com/owner/repo',
    ]) {
      git('remote', 'set-url', 'origin', remote)
      expect(githubRepositoryFromUrl(remote)).toBe('owner/repo')
      expect(isGitHubShellWrite([['git', 'push', 'origin']], dir)).toBe(true)
      await expect(runGitHubRepositoryAction({ repository: 'owner/repo', action: 'commit', message: 'test' }, dir,
        async () => { throw new Error('identity reached') })).rejects.toThrow('identity reached')
    }
    for (const remote of ['https://github.com.example.com/owner/repo', 'ssh://git@example.com:22/owner/repo.git', 'not a URL']) {
      git('remote', 'set-url', 'origin', remote)
      expect(githubRepositoryFromUrl(remote)).toBeUndefined()
      expect(isGitHubShellWrite([['git', 'push', 'origin']], dir)).toBe(false)
      await expect(runGitHubRepositoryAction({ repository: 'owner/repo', action: 'commit', message: 'test' }, dir,
        async () => { throw new Error('identity reached') })).rejects.toThrow('origin')
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('accepts PEM, escaped PEM and bare PKCS1/PKCS8 keys without exposing invalid input', () => {
  for (const type of ['pkcs1', 'pkcs8'] as const) {
    const value = privateKey.export({ type, format: 'pem' }).toString()
    for (const encoded of [value, value.replace(/\n/g, '\\n'), value.replace(/-----[^\n]+-----/g, '').trim()]) {
      expect(appPrivateKey(encoded).asymmetricKeyType).toBe('rsa')
    }
  }
  for (const value of ['', 'secret-invalid-key', 'YWJj']) expect(() => appPrivateKey(value)).toThrow('Invalid GITHUB_APP_PRIVATE_KEY: expected an RSA private key')
  const { privateKey: ec } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  expect(() => appPrivateKey(ec.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow('Invalid GITHUB_APP_PRIVATE_KEY')
})

test('routes Git options, URL rewrites and unknown targets without blocking known non-GitHub remotes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selection-routing-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  try {
    git('init')
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    git('remote', 'add', 'other', 'https://example.com/repo.git')
    git('config', 'url.https://proxy.test/github/.insteadOf', 'git@github.com:')
    for (const args of [
      ['push', '-o', 'ci.skip', 'origin', 'HEAD'],
      ['push', '--push-option', 'ci.skip', 'origin'],
      ['push', '-oci.skip', 'origin'],
      ['push', '--repo', 'origin'], ['push', '--repo=origin'],
      ['-C', dir, '-c', 'advice.pushUpdateRejected=false', 'push', 'origin'],
      ['-C' + dir, '-cadvice.pushUpdateRejected=false', 'commit', '-m', 'test'],
      ['push', 'unknown'], ['push'],
      ['push', 'https://proxy.test/github/owner/repo.git'],
    ]) expect(isGitHubShellWrite([['git', ...args]], dir)).toBe(true)
    expect(isGitHubShellWrite([['git', 'push', 'other']], dir)).toBe(false)
    expect(isGitHubShellWrite([['git', 'log']], dir)).toBe(false)
    expect(isGitHubShellWrite([], dir)).toBe(false)
    expect(runPreToolUseChecks({
      toolName: 'Bash', input: { command: 'git push -o ci.skip origin HEAD' }, workingDirectory: dir,
    } as PreToolUseInput).type).toBe('block')
    for (const prefix of [
      ['env'], ['env', '-i', 'FOO=1'], ['command', '-p'], ['exec', '-a', 'git-alias'],
      ['nice', '-n', '5'], ['nohup'], ['time', '-f', '%E'], ['sudo', '-u', 'user'],
      ['xargs', '-0', '-n', '1'], ['env', 'FOO=1', 'nice', '-n5', 'command'],
      ['env', '--unknown', 'value'], ['xargs', '--unknown', 'value'],
    ]) {
      const words = [...prefix, 'git', 'push', 'origin', 'HEAD']
      expect(isGitHubShellWrite([words], dir)).toBe(true)
      expect(runPreToolUseChecks({
        toolName: 'Bash', input: { command: words.join(' ') }, workingDirectory: dir,
      } as PreToolUseInput).type).toBe('block')
    }
    expect(isGitHubShellWrite([['env', 'git', 'log']], dir)).toBe(false)
    for (const lookup of [
      ['command', '-v'], ['command', '-V'], ['command', '-pv'], ['command', '-p', '-V'],
      ['env', 'FOO=1', 'command', '-v'], ['type'], ['which'],
    ]) {
      expect(isGitHubShellWrite([[...lookup, 'git'], ['git', 'status']], dir)).toBe(false)
      const commands = extractSimpleCommandsStrict([...lookup, 'git'].join(' ') + ' && git status')
      expect(commands).not.toBeNull()
      expect(isGitHubShellWrite(commands!, dir)).toBe(false)
      expect(isGitHubShellWrite([[...lookup, 'git'], ['git', 'push', 'origin']], dir)).toBe(true)
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('classifies publish conflicts, invalid input and infrastructure failures', () => {
  for (const stderr of ['stale info', 'non-fast-forward', 'GH013: Repository rule violations', 'hook declined']) {
    expect(publishFailure({ stderr }).status).toBe(409)
  }
  expect(publishFailure({ code: 'ENOENT' }).status).toBe(502)
  expect(publishFailure({ stderr: 'No space left on device' }).status).toBe(502)
  expect(publishFailure({ killed: true }).status).toBe(503)
  expect(publishFailure({ code: 1 }, ['merge-base']).status).toBe(422)
  expect(publishFailure({ stderr: 'does not look like a v2 bundle file' }).status).toBe(422)
  expect(publishFailure({ stderr: 'does not look like a v2 or v3 bundle file' }).status).toBe(422)
  expect(publishFailure({ stderr: 'fatal: git cat-file: could not get object info' }).status).toBe(422)
})

test('publishing enforces a shared deadline and preserves success if cleanup fails', async () => {
  const signals: AbortSignal[] = []
  await expect(publishBranch(input, 'test', {
    deadlineMs: 10,
    execute: async (_args, signal) => {
      signals.push(signal)
      if (signals.length === 1) return ''
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject({ code: 'ABORT_ERR' }), { once: true })
      })
    },
  })).rejects.toMatchObject({ status: 503 })
  expect(signals.length).toBe(2)
  expect(signals[0]).toBe(signals[1])
  expect(await publishBranch(input, 'test', {
    execute: async args => args[0] === 'cat-file' ? 'commit' : '',
    cleanup: async dir => { await rm(dir, { recursive: true, force: true }); throw new Error('cleanup failed') },
  })).toEqual({ sha, branch: 'feature' })
  await expect(publishBranch({ ...input, baseSha: 'b'.repeat(40) }, 'test', { execute: async () => '' })).rejects.toMatchObject({ status: 422 })
  await expect(publishBranch(input, 'test', { execute: async args => args[0] === 'cat-file' ? 'blob' : '' })).rejects.toMatchObject({ status: 422 })
})

test('push pool rejects overload, releases slots and maps publish statuses', async () => {
  const api = async (url: string) => Response.json(
    url.includes('/applications/') ? {} : url.endsWith('/installation') ? { id: 1 } :
      url.endsWith('/access_tokens') ? { token: 'installation' } : { id: 1, permissions: { push: true } },
  )
  const send = (handler: ReturnType<typeof createGitHubAppHandler>, value = input) => handler(new Request('https://broker.test/push', {
    method: 'POST', headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(value),
  }))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const handler = createGitHubAppHandler(config, api, async () => { await pending; return { sha, branch: 'feature' } })
  const first = send(handler)
  const second = send(handler)
  const busy = await send(handler)
  expect(busy.status).toBe(503)
  expect(busy.headers.get('retry-after')).toBe('5')
  release()
  expect((await first).status).toBe(200)
  expect((await second).status).toBe(200)
  expect((await send(handler)).status).toBe(200)
  for (const status of [409, 422, 502, 503]) {
    const failing = createGitHubAppHandler(config, api, async () => { throw new PublishError(status, 'test failure') })
    expect((await send(failing)).status).toBe(status)
    expect((await send(failing)).status).toBe(status)
  }
  expect((await send(handler, { ...input, head: '..' })).status).toBe(400)
  const broken = createGitHubAppHandler(config, api, async () => { throw new Error('internal detail') })
  const unavailable = await send(broken)
  expect(unavailable.status).toBe(502)
  expect(await unavailable.text()).not.toContain('internal detail')
})
