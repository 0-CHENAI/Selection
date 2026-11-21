import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitHubAppHandler } from './server'
import { githubShellEnvironment } from '../../packages/session-tools-core/src/runtime/github-shell'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config = { clientId: 'test-app', clientSecret: 'test-secret', slug: 'selection-test', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
function fixture(options: { member?: boolean; push?: boolean; grant?: 'pull_requests' | 'contents'; invalidUser?: boolean; pr?: boolean; installDenied?: boolean } = {}) {
  const writes: { path: string; auth: string; method: string; body: unknown }[] = []
  const handler = createGitHubAppHandler(config, async (url, init) => {
    const path = new URL(String(url)).pathname
    const auth = new Headers(init?.headers).get('authorization')!
    const body = init?.body && JSON.parse(String(init.body))
    if (path === '/applications/test-app/token') {
      expect(auth).toBe('Basic ' + Buffer.from('test-app:test-secret').toString('base64'))
      expect(body).toEqual({ access_token: 'user' })
      return Response.json({}, { status: options.invalidUser ? 404 : 200 })
    }
    if (path === '/repos/owner/repo') {
      expect(auth).toBe('Bearer user')
      return Response.json({ id: 42, permissions: { triage: options.member !== false, push: options.push } })
    }
    if (path.endsWith('/installation')) {
      expect(auth.split('.')).toHaveLength(3)
      return Response.json({ id: 15 }, { status: options.installDenied ? 404 : 200 })
    }
    if (path.endsWith('/access_tokens')) {
      expect(path).toBe('/app/installations/15/access_tokens')
      expect(auth.split('.')).toHaveLength(3)
      expect(body).toEqual({ repository_ids: [42], permissions: { [options.grant ?? 'issues']: 'write' } })
      return Response.json({ token: 'installation' })
    }
    expect(auth).toBe('Bearer installation')
    if (path === '/users/selection-test%5Bbot%5D') return Response.json({ id: 123, login: 'selection-test[bot]' })
    if (init?.method === 'GET') return Response.json(options.pr ? { pull_request: {} } : { number: 7 })
    writes.push({ path, auth, method: init!.method!, body })
    return Response.json({ number: 7, html_url: 'https://github.com/owner/repo/' + (path.endsWith('/pulls') ? 'pull' : 'issues') + '/7' })
  })
  return { writes, send: (input: object, route = '/issues') => handler(new Request('https://broker.test' + route, {
    method: 'POST', headers: { authorization: 'Bearer user', 'content-type': 'application/json' },
    body: JSON.stringify({ repository: 'owner/repo', ...input }),
  })) }
}

test('create, comment and close all use a repository-limited installation token', async () => {
  const { writes, send } = fixture()
  for (const input of [{ action: 'create', title: 'Test' }, { action: 'comment', number: 7, body: 'Done' }, { action: 'close', number: 7 }]) {
    expect((await send(input)).status).toBe(200)
  }
  expect(writes).toEqual([
    { path: '/repos/owner/repo/issues', auth: 'Bearer installation', method: 'POST', body: { title: 'Test' } },
    { path: '/repos/owner/repo/issues/7/comments', auth: 'Bearer installation', method: 'POST', body: { body: 'Done' } },
    { path: '/repos/owner/repo/issues/7', auth: 'Bearer installation', method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } },
  ])
})

test('denied access, nonmembers, pull requests and invalid input produce no writes', async () => {
  for (const [options, status] of [[{ invalidUser: true }, 401], [{ member: false }, 403], [{ pr: true }, 422], [{ installDenied: true }, 404]] as const) {
    const { send, writes } = fixture(options)
    expect((await send({ action: 'close', number: 7 })).status).toBe(status)
    expect(writes).toHaveLength(0)
  }
  const { send, writes } = fixture()
  expect((await send({ action: 'create', title: ' ' })).status).toBe(400)
  expect((await send({ action: 'create', title: 'title', repository: 'owner/..' })).status).toBe(400)
  expect(writes).toHaveLength(0)
})

test('shell cannot inherit the personal CLI login or token', () => {
  const original = { GH_CONFIG_DIR: '/personal', GH_TOKEN: 'private', github_token: 'private', GH_ENTERPRISE_TOKEN: 'private', PATH: '/bin' }
  const env = githubShellEnvironment(original)
  expect(env.GH_CONFIG_DIR).not.toBe(original.GH_CONFIG_DIR)
  expect(env).toEqual({ GH_CONFIG_DIR: env.GH_CONFIG_DIR, GH_PROMPT_DISABLED: '1', PATH: '/bin' })
  expect(original.GH_TOKEN).toBe('private')
})

test('device flow, refresh, installation and disconnect through the host credential store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selection-connection-test-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'connection.fixture.ts')], {
      env: { ...process.env, CRAFT_CONFIG_DIR: dir, GH_TOKEN: 'personal-must-never-be-used' },
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('packaged desktop authorizes with the official App and sends writes only to its bundled service', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selection-packaged-connection-'))
  try {
    const fixture = JSON.stringify(join(import.meta.dir, 'connection.fixture.ts'))
    const child = Bun.spawn([process.execPath, '-e',
      "globalThis.__SELECTION_GITHUB_BROKER_ORIGIN__ = 'https://broker.test'; await import(" + fixture + ")",
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: dir, TEST_SELECTION_PACKAGED_APP: '1' },
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('only write members can use the bot identity and open a same-repository PR', async () => {
  const params = { title: '机器人提交', head: 'feature/test', base: 'test', draft: true }
  const denied = fixture()
  for (const [route, input] of [['/identity', {}], ['/pulls', params]] as const) {
    expect((await denied.send(input, route)).status).toBe(403)
  }
  expect(denied.writes).toHaveLength(0)
  const identity = await fixture({ push: true, grant: 'contents' }).send({}, '/identity')
  expect(await identity.json()).toEqual({ name: 'selection-test[bot]', email: '123+selection-test[bot]@users.noreply.github.com' })
  const pr = fixture({ push: true, grant: 'pull_requests' })
  expect((await pr.send({ ...params, head: '../other' }, '/pulls')).status).toBe(400)
  expect((await pr.send({ ...params, head: 'test' }, '/pulls')).status).toBe(400)
  expect(await (await pr.send(params, '/pulls')).json()).toEqual({ url: 'https://github.com/owner/repo/pull/7', number: 7 })
  expect(pr.writes).toEqual([{ path: '/repos/owner/repo/pulls', auth: 'Bearer installation', method: 'POST', body: params }])
})
