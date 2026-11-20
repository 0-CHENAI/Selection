import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod/v3'
import { branchName, GitHubRepositorySchema, pullInput, type GitHubRepositoryInput } from '@craft-agent/session-tools-core'
import { gitEnv, gitExecutable } from '../runtime/git-command'
import { githubAppRequest } from './github-app-connection'

const sha = z.string().regex(/^[0-9a-f]{40}$/)
const actor = z.object({ name: z.string().regex(/^[\w-]+\[bot\]$/), email: z.string().regex(/^\d+\+[\w-]+\[bot\]@users\.noreply\.github\.com$/) })
const pullReply = z.object({ number: z.number().int().positive(), url: z.string().url() })
const branchInfo = z.object({ expected: sha.nullable(), baseSha: sha })
const pushReply = z.object({ sha, branch: z.string() })

export async function runGitHubRepositoryAction(input: GitHubRepositoryInput, cwd: string, request = githubAppRequest) {
  const { action, repository, ...params } = GitHubRepositorySchema.parse(input)
  if (action === 'create_pr') {
    const pull = pullInput.parse({ repository, ...params })
    return request('/pulls', pullReply, pull)
  }
  const git = async (args: string[], env?: NodeJS.ProcessEnv) =>
    (await promisify(execFile)(gitExecutable(), args, { cwd, env: gitEnv(env), timeout: 60000, maxBuffer: 1024 * 1024 })).stdout.trim()
  const remote = await git(['remote', 'get-url', '--push', 'origin'])
  const ownerRepo = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote)?.[1]
  if (ownerRepo?.toLowerCase() !== repository.toLowerCase()) throw new Error('当前工作目录的 origin 与指定的 GitHub 仓库不一致。')
  const head = branchName.parse(await git(['branch', '--show-current']))
  if (action === 'commit') {
    const { message } = GitHubRepositorySchema.pick({ message: true }).required().parse(params)
    const { name, email } = await request('/identity', actor, { repository })
    // Explicit author also overrides Git's author reuse when finishing a cherry-pick.
    await git(['-c', 'commit.gpgSign=false', 'commit', '--author=' + name + ' <' + email + '>', '-m', message], {
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
    })
    return { sha: sha.parse(await git(['rev-parse', 'HEAD'])), branch: head, author: name }
  }
  const push = GitHubRepositorySchema.pick({ head: true, base: true }).parse(params)
  if (push.head && push.head !== head) throw new Error('请先切换到要推送的本地分支。')
  const { expected, baseSha } = await request('/branch', branchInfo, { repository, head, base: push.base })
  const tip = sha.parse(await git(['rev-parse', 'HEAD']))
  if (expected === tip) return { sha: tip, branch: head }
  let common: string
  try { common = sha.parse(await git(['merge-base', tip, baseSha])) }
  catch { throw new Error('本地缺少远端基准提交，请先同步仓库。') }
  if (expected && expected !== common) throw new Error('远端分支已有新提交，请先整合远端改动。')
  const dir = await mkdtemp(join(tmpdir(), 'selection-bundle-'))
  try {
    let bundle = ''
    if (tip !== common) {
      const path = join(dir, 'changes.bundle')
      await git(['bundle', 'create', path, 'HEAD', '^' + common])
      if ((await stat(path)).size > 12 * 1024 * 1024) throw new Error('此次推送超过 12 MiB，请分批提交并推送。')
      bundle = (await readFile(path)).toString('base64')
    }
    return await request('/push', pushReply, { repository, head, expected, baseSha: common, tip, bundle })
  } finally { await rm(dir, { recursive: true, force: true }) }
}
