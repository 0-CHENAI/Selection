import assert from 'node:assert/strict'
import { githubAppConnection, writeGitHubIssue } from '../../packages/server-core/src/services/github-app-connection'
import { SESSION_TOOL_REGISTRY } from '../../packages/session-tools-core/src'
import { runPreToolUseChecks, type PreToolUseInput } from '../../packages/shared/src/agent/core/pre-tool-use'
import { isRemoteEligible, RPC_CHANNELS } from '../../packages/shared/src/protocol'

import { runGitHubRepositoryAction } from '../../packages/server-core/src/services/github-repository'

const origin = 'https://broker.test'
let now = Date.now()
Date.now = () => now
let installed = false
let polls = 0
let refreshes = 0
let writes = 0
const pull = { repository: 'owner/repo', action: 'create_pr', head: 'feature/fix', base: 'test', title: '修复问题' } as const
const issue = { repository: 'owner/repo', action: 'create', title: 'Test' } as const
globalThis.fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
  assert.ok(!JSON.stringify(init).includes('personal-must-never-be-used'))
  const data = JSON.parse(String(init?.body || '{}'))
  switch (String(url)) {
    case 'https://github.com/login/device/code':
      assert.equal(data.client_id, 'Iv23lis5c0ZG0dIHW3ma')
      return Response.json({ device_code: 'device-secret', user_code: '1234-5678', interval: 5, expires_in: 900 })
    case 'https://github.com/login/oauth/access_token':
      assert.equal(data.device_code, 'device-secret')
      polls++
      return Response.json(polls === 1 ? { error: 'slow_down' } : { access_token: 'first', refresh_token: 'renew', expires_in: 3600 })
    case 'https://api.github.com/user': return Response.json({ login: 'repo-owner' })
    case origin + '/refresh':
      assert.deepEqual(data, { refresh_token: 'renew' })
      refreshes++
      return Response.json({ access_token: 'second', refresh_token: 'rotated', expires_in: 3600 })
    case 'https://api.github.com/user/installations?per_page=100&page=1':
      return Response.json({ installations: [{ app_slug: 'selection-agent', suspended_at: installed ? null : '2026-01-01', permissions: { issues: 'write', contents: 'write', pull_requests: 'write' } }] })
    case origin + '/pulls':
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer second')
      assert.deepEqual(data, { repository: pull.repository, head: pull.head, base: pull.base, title: pull.title })
      return Response.json({ url: 'https://github.com/owner/repo/pull/8', number: 8 })
    case origin + '/issues':
      writes++
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer second')
      assert.deepEqual(data, issue)
      return Response.json({ url: 'https://github.com/owner/repo/issues/7', number: 7 })
    default: throw new Error('Unexpected URL ' + String(url))
  }
}, { preconnect: fetch.preconnect })

if (process.env.TEST_SELECTION_PACKAGED_APP === '1') {
  // Model a packaged host with the publisher's origin and a conflicting shell environment.
  process.env.SELECTION_GITHUB_APP_URL = 'https://other.test'
  assert.equal((await githubAppConnection('connect')).state, 'pending')
  now += 5000
  await githubAppConnection('poll')
  now += 10000
  installed = true
  assert.deepEqual(await githubAppConnection('poll'), { state: 'connected', login: 'repo-owner', serviceAvailable: true })
  now += 3600000
  await writeGitHubIssue(issue)
  assert.equal(refreshes, 1)
  assert.equal(writes, 1)
  process.exit(0)
}

assert.ok(isRemoteEligible(RPC_CHANNELS.settings.GITHUB_APP))
delete process.env.SELECTION_GITHUB_APP_URL
assert.equal((await githubAppConnection('status')).state, 'disconnected')
await assert.rejects(writeGitHubIssue(issue), /设置.*外部连接/)
assert.equal((await githubAppConnection('connect')).state, 'pending')
await githubAppConnection('disconnect')
process.env.SELECTION_GITHUB_APP_URL = origin
assert.equal((await githubAppConnection('status')).state, 'disconnected')
await assert.rejects(writeGitHubIssue(issue), /设置.*外部连接/)
assert.deepEqual(await githubAppConnection('connect'), { state: 'pending', userCode: '1234-5678' })
await githubAppConnection('poll')
assert.equal(polls, 0)
now += 5000
await githubAppConnection('poll')
now += 5000
await githubAppConnection('poll')
assert.equal(polls, 1)
now += 5000
assert.deepEqual(await githubAppConnection('poll'), { state: 'install', login: 'repo-owner', serviceAvailable: true })
installed = true
assert.equal((await githubAppConnection('status')).state, 'connected')
now += 3600000
const tool = SESSION_TOOL_REGISTRY.get('github_issue')!
const result = await tool.handler!({ githubIssue: writeGitHubIssue } as Parameters<NonNullable<typeof tool.handler>>[0], issue)
assert.equal(result.isError, false)
assert.equal(writes, 1)
const repoTool = SESSION_TOOL_REGISTRY.get('github_repository')!
assert.equal(repoTool.safeMode, 'block')
const repoResult = await repoTool.handler!({
  githubRepository: args => runGitHubRepositoryAction(args, '/unused-for-pr'),
} as Parameters<NonNullable<typeof repoTool.handler>>[0], pull)
assert.equal(repoResult.isError, false)
assert.equal(refreshes, 1)
process.env.SELECTION_GITHUB_APP_URL = 'https://other.test'
await assert.rejects(writeGitHubIssue(issue), /设置.*外部连接/)
process.env.SELECTION_GITHUB_APP_URL = origin
assert.equal((await githubAppConnection('disconnect')).state, 'disconnected')
await assert.rejects(writeGitHubIssue(issue), /设置.*外部连接/)
await assert.rejects(runGitHubRepositoryAction(pull, '/unused-for-pr'), /设置.*外部连接/)
assert.equal(writes, 1)
// A stock build can complete account and repository consent before the signing service is deployed.
delete process.env.SELECTION_GITHUB_APP_URL
await githubAppConnection('connect')
now += 5000
assert.deepEqual(await githubAppConnection('poll'), { state: 'connected', login: 'repo-owner', serviceAvailable: false })
await assert.rejects(writeGitHubIssue(issue), /机器人服务暂不可用/)
process.env.SELECTION_GITHUB_APP_URL = 'https://other.test'
await assert.rejects(writeGitHubIssue(issue), /设置.*外部连接/)
assert.equal(writes, 1)
await githubAppConnection('disconnect')
const block = runPreToolUseChecks({ toolName: 'Bash', input: { command: 'gh -R owner/repo issue close 7' } } as PreToolUseInput)
assert.equal(block.type, 'block')

assert.equal(runPreToolUseChecks({ toolName: 'Bash', input: { command: 'gh -R owner/repo pr create --base test' } } as PreToolUseInput).type, 'block')
