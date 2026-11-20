import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { pushInput } from '../../packages/session-tools-core/src/github-repository-protocol'

type BranchUpdate = ReturnType<typeof pushInput.parse>

// Keep installation credentials in this service. Git runs in a fresh repository,
// with a single pinned remote and no user config, hooks or credential helpers.
export async function publishBranch(input: BranchUpdate, token: string) {
  const dir = await mkdtemp(join(tmpdir(), 'selection-publish-'))
  const url = 'https://github.com/' + input.repository + '.git'
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https', GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64'),
    GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: devNull,
  }
  const run = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: dir, env, timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim()
  try { return await publishBundle(input, dir, url, run) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

export async function publishBundle(input: BranchUpdate, dir: string, url: string, run: (...args: string[]) => Promise<string>) {
  const ref = 'refs/heads/' + input.head
  await run('init', '--bare', '--template=')
  // An existing destination must advance from its exact observed tip.
  if (input.expected !== null && input.baseSha !== input.expected) throw new Error('Invalid base')
  // A named promisor remote can supply delta bases on demand without downloading
  // the entire base snapshot for a small push.
  await run('remote', 'add', 'origin', url)
  await run('fetch', '--filter=blob:none', '--no-tags', '--depth=1', 'origin', input.baseSha + ':refs/selection/base')
  if (input.bundle) {
    const path = join(dir, 'changes.bundle')
    await writeFile(path, Buffer.from(input.bundle, 'base64'))
    if (await run('bundle', 'list-heads', path) !== input.tip + ' HEAD') throw new Error('Unexpected bundle head')
    await run('bundle', 'unbundle', path)
  }
  if (await run('cat-file', '-t', input.tip) !== 'commit') throw new Error('Expected a commit')
  await run('merge-base', '--is-ancestor', input.baseSha, input.tip)
  // Pair the ancestry check with an atomic lease, including for a new ref.
  await run('push', '--force-with-lease=' + ref + ':' + (input.expected ?? ''), 'origin', input.tip + ':' + ref)
  return { sha: input.tip, branch: input.head }
}
