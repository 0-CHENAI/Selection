import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { pushInput } from '../../packages/session-tools-core/src/github-repository-protocol'

type BranchUpdate = ReturnType<typeof pushInput.parse>

export class PublishError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function publishFailure(error: unknown, args: string[] = []): PublishError {
  if (error instanceof PublishError) return error
  const failure = error as { killed?: boolean; code?: string | number; stderr?: string }
  if (failure?.killed || failure?.code === 'ABORT_ERR') return new PublishError(503, 'Publish deadline exceeded; retry shortly.')
  if (/stale info|non-fast-forward|fetch first|GH006|GH013|protected branch|repository rule|hook declined/i.test(failure?.stderr ?? '')) {
    return new PublishError(409, 'Target branch changed or branch rules rejected the push.')
  }
  if ((args[0] === 'merge-base' && failure?.code === 1) ||
    /does not look like a v[23](?: or v3)? bundle|not a git bundle|invalid bundle|unrecognized header|prerequisites|bad object|not a valid object|could not get object info/i.test(failure?.stderr ?? '')) {
    return new PublishError(422, 'Invalid Git bundle or commit ancestry')
  }
  return new PublishError(502, 'Publish service unavailable; retry shortly.')
}

// Keep installation credentials in this service. Git runs in a fresh repository,
// with a single pinned remote and no user config, hooks or credential helpers.
export async function publishBranch(input: BranchUpdate, token: string, options: {
  deadlineMs?: number
  cleanup?: (dir: string) => Promise<unknown>
  execute?: (args: string[], signal: AbortSignal) => Promise<string>
} = {}) {
  const deadline = AbortSignal.timeout(options.deadlineMs ?? 90000)
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
  const run = async (...args: string[]) => {
    if (deadline.aborted) throw new PublishError(503, 'Publish deadline exceeded; retry shortly.')
    try {
      if (options.execute) return await options.execute(args, deadline)
      return (await promisify(execFile)('git', args, { cwd: dir, env, signal: deadline, timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim()
    } catch (error) { throw publishFailure(error, args) }
  }
  try { return await publishBundle(input, dir, url, run) }
  finally { await (options.cleanup ? options.cleanup(dir) : rm(dir, { recursive: true, force: true })).catch(() => { console.error('Could not clean publish temporary directory') }) }
}

export async function publishBundle(input: BranchUpdate, dir: string, url: string, run: (...args: string[]) => Promise<string>) {
  const ref = 'refs/heads/' + input.head
  await run('init', '--bare', '--template=')
  // An existing destination must advance from its exact observed tip.
  if (input.expected !== null && input.baseSha !== input.expected) throw new PublishError(422, 'Invalid base')
  // A named promisor remote can supply delta bases on demand without downloading
  // the entire base snapshot for a small push.
  await run('remote', 'add', 'origin', url)
  await run('fetch', '--filter=blob:none', '--no-tags', '--depth=1', 'origin', input.baseSha + ':refs/selection/base')
  if (input.bundle) {
    const path = join(dir, 'changes.bundle')
    await writeFile(path, Buffer.from(input.bundle, 'base64'))
    if (await run('bundle', 'list-heads', path) !== input.tip + ' HEAD') throw new PublishError(422, 'Unexpected bundle head')
    await run('bundle', 'unbundle', path)
  }
  if (await run('cat-file', '-t', input.tip) !== 'commit') throw new PublishError(422, 'Expected a commit')
  await run('merge-base', '--is-ancestor', input.baseSha, input.tip)
  // Pair the ancestry check with an atomic lease, including for a new ref.
  await run('push', '--force-with-lease=' + ref + ':' + (input.expected ?? ''), 'origin', input.tip + ':' + ref)
  return { sha: input.tip, branch: input.head }
}
