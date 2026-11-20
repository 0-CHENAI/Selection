// Deploy separately from Selection. Only this process holds the App signing key.
import { createPrivateKey, sign } from 'node:crypto'
import { z } from 'zod/v3'
import { SELECTION_GITHUB_CLIENT_ID, SELECTION_GITHUB_APP_SLUG } from '../../packages/shared/src/protocol/github-app'
import { parseGitHubIssue } from '../../packages/session-tools-core/src/handlers/github-issue'

import { branchInput, pullInput, pushInput, repositoryInput } from '../../packages/session-tools-core/src/github-repository-protocol'
import { publishBranch, PublishError } from './publish'

const pullReply = z.object({ number: z.number().int().positive(), html_url: z.string().url() })

interface AppConfig {
  clientId: string
  clientSecret: string
  slug: string
  privateKey: string
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function appPrivateKey(value: string) {
  const text = value.trim().replace(/\\n/g, '\n')
  try {
    const key = (() => {
      if (text.startsWith('-----BEGIN ')) return createPrivateKey(text)
      if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(text)) throw new Error()
      const body = Buffer.from(text.replace(/\s/g, ''), 'base64')
      try { return createPrivateKey({ key: body, format: 'der', type: 'pkcs1' }) }
      catch { return createPrivateKey({ key: body, format: 'der', type: 'pkcs8' }) }
    })()
    if (key.asymmetricKeyType !== 'rsa') throw new Error()
    return key
  } catch { throw new Error('Invalid GITHUB_APP_PRIVATE_KEY: expected an RSA private key in PEM or base64 DER format') }
}

export function createGitHubAppHandler(config: AppConfig, request: (url: string, init: RequestInit) => Promise<Response> = fetch, publish = publishBranch) {
  const key = appPrivateKey(config.privateKey)
  let pushes = 0
  const basic = 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64')
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
  function appJwt() {
    const now = Math.floor(Date.now() / 1000)
    const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: config.clientId, iat: now - 60, exp: now + 300 })
    return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), key).toString('base64url')
  }

  async function api(path: string, authorization: string, method = 'GET', body?: object) {
    const res = await request('https://api.github.com' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'Selection-GitHub-App' },
      body: body && JSON.stringify(body),
    })
    if (!res.ok) throw new RequestError(res.status, 'GitHub rejected the request (HTTP ' + res.status + ').')
    return res.json()
  }

  async function route(req: Request) {
    const path = new URL(req.url).pathname
    if (path === '/info' && req.method === 'GET') return { clientId: config.clientId, slug: config.slug }
    if (req.method !== 'POST' || !['/issues', '/refresh', '/pulls', '/identity', '/branch', '/push'].includes(path)) throw new RequestError(404, 'Not found')
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(415, 'Expected JSON')
    const body: unknown = await req.json().catch(() => { throw new RequestError(400, 'Invalid JSON') })
    if (path === '/refresh') {
      const refresh = z.object({ refresh_token: z.string().min(1) }).safeParse(body)
      if (!refresh.success) throw new RequestError(400, 'Missing refresh token')
      const res = await request('https://github.com/login/oauth/access_token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: refresh.data.refresh_token }),
      })
      if (!res.ok) throw new RequestError(502, 'GitHub token service unavailable')
      const data = z.object({ access_token: z.string().optional(), refresh_token: z.string().optional(), expires_in: z.number().optional(), error: z.string().optional() }).parse(await res.json())
      if (!data.access_token) throw new RequestError(data.error === 'bad_refresh_token' ? 401 : 502, 'Could not refresh connection')
      return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }
    }

    const operation = (() => {
      try {
        switch (path) {
          case '/issues': return { kind: 'issue', input: parseGitHubIssue(body) } as const
          case '/pulls': return { kind: 'pull', input: pullInput.parse(body) } as const
          case '/identity': return { kind: 'identity', input: repositoryInput.parse(body) } as const
          case '/branch': return { kind: 'branch', input: branchInput.parse(body) } as const
          case '/push': return { kind: 'push', input: pushInput.parse(body) } as const
          default: throw new Error()
        }
      } catch { throw new RequestError(400, 'Invalid parameters') }
    })()
    const user = req.headers.get('authorization') ?? ''
    if (!/^Bearer [^\s]+$/.test(user)) throw new RequestError(401, 'Connect GitHub')
    try {
      await api('/applications/' + config.clientId + '/token', basic, 'POST', { access_token: user.slice(7) })
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) throw new RequestError(401, 'Connect GitHub')
      throw error
    }
    const repoPath = '/repos/' + operation.input.repository
    const repo = z.object({
      id: z.number().int().positive().safe(),
      default_branch: z.string().optional(),
      permissions: z.object({ push: z.boolean().optional(), triage: z.boolean().optional(), admin: z.boolean().optional(), maintain: z.boolean().optional() }).optional(),
    }).parse(await api(repoPath, user))
    if (!repo.permissions?.push && !(operation.kind === 'issue' && repo.permissions?.triage) && !repo.permissions?.admin && !repo.permissions?.maintain) {
      throw new RequestError(403, 'Insufficient repository permissions')
    }
    const jwt = 'Bearer ' + appJwt()
    const installation = z.object({ id: z.number().int().positive().safe(), suspended_at: z.string().nullish() }).parse(await api(repoPath + '/installation', jwt))
    if (installation.suspended_at) throw new RequestError(403, 'Installation unavailable')
    const grant = z.object({ token: z.string().min(1) }).parse(await api('/app/installations/' + installation.id + '/access_tokens', jwt, 'POST', {
      repository_ids: [repo.id], permissions: operation.kind === 'issue' ? { issues: 'write' } : operation.kind === 'pull' ? { pull_requests: 'write' } : { contents: 'write' },
    }))
    const bot = 'Bearer ' + grant.token
    if (operation.kind === 'identity') {
      const login = config.slug + '[bot]'
      const user = z.object({ id: z.number().int().positive().safe(), login: z.literal(login) })
        .parse(await api('/users/' + encodeURIComponent(login), bot))
      return { name: login, email: user.id + '+' + login + '@users.noreply.github.com' }
    }
    if (operation.kind === 'pull') {
      const { repository, ...params } = operation.input
      const result = pullReply.parse(await api(repoPath + '/pulls', bot, 'POST', params))
      return { number: result.number, url: result.html_url }
    }
    if (operation.kind === 'branch') {
      const lookup = async (branch: string) => z.object({ object: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) })
        .parse(await api(repoPath + '/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'), bot)).object.sha
      try {
        const expected = await lookup(operation.input.head)
        return { expected, baseSha: expected }
      } catch (error) {
        if (!(error instanceof RequestError && error.status === 404)) throw error
      }
      const base = operation.input.base ?? repo.default_branch
      if (!base) throw new RequestError(422, 'Missing base branch')
      return { expected: null, baseSha: await lookup(base) }
    }
    if (operation.kind === 'push') {
      try { return await publish(operation.input, grant.token) }
      catch (error) {
        if (error instanceof PublishError) throw new RequestError(error.status, error.message)
        throw new RequestError(502, 'Publish service unavailable; retry shortly.')
      }
    }
    const input = operation.input
    const issues = repoPath + '/issues'
    const target = issues + '/' + input.number
    if (input.action !== 'create') {
      const issue = z.object({ pull_request: z.object({}).optional() }).parse(await api(target, bot))
      if (issue.pull_request) throw new RequestError(422, 'Target is a pull request')
    }
    const response = input.action === 'create' ? await api(issues, bot, 'POST', { title: input.title, body: input.body })
      : input.action === 'comment' ? await api(target + '/comments', bot, 'POST', { body: input.body })
      : await api(target, bot, 'PATCH', { state: 'closed', state_reason: 'completed' })
    const result = z.object({ number: z.number().optional(), html_url: z.string().url() }).parse(response)
    return { number: input.number ?? result.number, url: result.html_url }
  }

  return async (req: Request) => {
    const headers = { 'cache-control': 'no-store' }
    const push = req.method === 'POST' && new URL(req.url).pathname === '/push'
    if (push && pushes >= 2) return Response.json({ error: 'Publish service busy; retry shortly.' }, { status: 503, headers: { ...headers, 'retry-after': '5' } })
    if (push) pushes++
    try { return Response.json(await route(req), { headers }) }
    catch (err) {
      const error = err instanceof RequestError ? err : new RequestError(502, 'GitHub service unavailable')
      return Response.json({ error: error.message }, { status: error.status, headers })
    } finally { if (push) pushes-- }
  }
}

if (import.meta.main) {
  function setting(name: string) {
    const value = process.env[name]
    if (!value) throw new Error('Missing ' + name)
    return value
  }
  Bun.serve({
    port: Number(process.env.PORT ?? 3000), maxRequestBodySize: 17 * 1024 * 1024, idleTimeout: 120,
    fetch: createGitHubAppHandler({
      clientId: SELECTION_GITHUB_CLIENT_ID, clientSecret: setting('GITHUB_APP_CLIENT_SECRET'),
      slug: SELECTION_GITHUB_APP_SLUG, privateKey: setting('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  })
}
