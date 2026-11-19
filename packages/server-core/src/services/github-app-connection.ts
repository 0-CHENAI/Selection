import { z } from 'zod/v3'
import { getCredentialManager, type StoredCredential } from '@craft-agent/shared/credentials'
import { SELECTION_GITHUB_APP_SLUG, SELECTION_GITHUB_CLIENT_ID, type GitHubConnectionAction, type GitHubConnectionStatus } from '@craft-agent/shared/protocol'

const credential = { type: 'github_app_connection' } as const
const connectHint = '请前往「设置 → 外部连接」连接 GitHub。'
const deviceHost = 'https://github.com/login'
declare const __SELECTION_GITHUB_BROKER_ORIGIN__: string
const bundledBroker = typeof __SELECTION_GITHUB_BROKER_ORIGIN__ === 'string' ? __SELECTION_GITHUB_BROKER_ORIGIN__ : ''
type Device = { broker: string | undefined; code: string; userCode: string; expires: number; interval: number; nextPoll: number }

class HttpError extends Error {
  constructor(readonly status: number) { super('GitHub HTTP ' + status) }
}
const tokenReply = z.object({
  access_token: z.string().min(1).optional(), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive().optional(),
  error: z.string().optional(), interval: z.number().positive().optional(),
})
const deviceReply = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1), expires_in: z.number().positive(), interval: z.number().positive().optional(),
})
const accountReply = z.object({ login: z.string().min(1) })
const installationsReply = z.object({
  installations: z.array(z.object({ app_slug: z.string(), suspended_at: z.string().nullable(), permissions: z.object({ issues: z.string().optional(), pull_requests: z.string().optional(), contents: z.string().optional() }) })),
})

async function json<T>(schema: z.ZodType<T>, url: string, body?: object, token?: string) {
  const res = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(url.endsWith('/push') ? 120000 : body ? 100000 : 20000),
    method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Selection', ...(token && { authorization: 'Bearer ' + token }) },
  })
  if (!res.ok) throw new HttpError(res.status)
  return schema.parse(await res.json())
}

function brokerOrigin() {
  const raw = bundledBroker || process.env.SELECTION_GITHUB_APP_URL?.trim()
  if (!raw) return undefined
  const url = new URL(raw)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid SELECTION_GITHUB_APP_URL')
  return url.origin
}

let device: Device | undefined
let queue = Promise.resolve()
// Serialize pairing, refresh-token rotation and disconnect, including across settings windows.
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work)
  queue = result.then(() => {}, () => {})
  return result
}

function tokenFields(data: { access_token?: string; refresh_token?: string; expires_in?: number }) {
  if (!data.access_token) throw new Error(connectHint)
  return { value: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined }
}

async function activeCredential(broker: string | undefined) {
  const manager = getCredentialManager()
  let stored = await manager.get(credential)
  if (!stored || stored.clientId !== SELECTION_GITHUB_CLIENT_ID || stored.githubAppSlug !== SELECTION_GITHUB_APP_SLUG) return null
  // An authorization obtained before the first managed release can be adopted only by its pinned service.
  if (stored.githubAppOrigin !== broker) {
    if (stored.githubAppOrigin || !bundledBroker || broker !== bundledBroker) return null
    const updated = { ...stored, githubAppOrigin: broker }
    await manager.set(credential, updated, stored)
    stored = updated
  }
  if (!stored.expiresAt || stored.expiresAt > Date.now() + 60000) return stored
  if (broker && stored.refreshToken) {
    try {
      const fields = tokenFields(await json(tokenReply, broker + '/refresh', { refresh_token: stored.refreshToken }))
      const updated = { ...stored, ...fields }
      await manager.set(credential, updated, stored)
      return updated
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 401)) throw err
    }
  }
  await manager.delete(credential)
  return null
}

async function installationStatus(stored: StoredCredential, serviceAvailable: boolean): Promise<GitHubConnectionStatus> {
  try {
    const { login } = await json(accountReply, 'https://api.github.com/user', undefined, stored.value)
    for (let page = 1; ; page++) {
      const { installations } = await json(installationsReply, 'https://api.github.com/user/installations?per_page=100&page=' + page, undefined, stored.value)
      if (installations.some(app => app.app_slug === SELECTION_GITHUB_APP_SLUG && !app.suspended_at && app.permissions.issues === 'write' && app.permissions.pull_requests === 'write' && app.permissions.contents === 'write')) return { state: 'connected', login, serviceAvailable }
      if (installations.length < 100) return { state: 'install', login, serviceAvailable }
    }
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 401)) throw err
    await getCredentialManager().delete(credential)
    return { state: 'disconnected' }
  }
}

export function githubAppConnection(action: GitHubConnectionAction): Promise<GitHubConnectionStatus> {
  return exclusive(async () => {
    if (action === 'disconnect') {
      device = undefined
      const manager = getCredentialManager()
      await manager.delete(credential)
      if (await manager.get(credential)) throw new Error('无法清除 GitHub 连接。')
      return { state: 'disconnected' }
    }
    const broker = brokerOrigin()
    if (device && (device.expires <= Date.now() || device.broker !== broker)) device = undefined
    if (device && action === 'poll' && Date.now() >= device.nextPoll) {
      device.nextPoll = Date.now() + device.interval
      const data = await json(tokenReply, deviceHost + '/oauth/access_token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: SELECTION_GITHUB_CLIENT_ID, device_code: device.code,
      })
      if (data.access_token) {
        await getCredentialManager().set(credential, {
          ...tokenFields(data), clientId: SELECTION_GITHUB_CLIENT_ID, githubAppOrigin: broker, githubAppSlug: SELECTION_GITHUB_APP_SLUG,
        })
        device = undefined
      } else if (data.error === 'slow_down') {
        device.interval = Math.max(device.interval + 5000, (Number(data.interval) || 0) * 1000)
        device.nextPoll = Date.now() + device.interval
      } else if (data.error !== 'authorization_pending') {
        device = undefined
        throw new Error(connectHint)
      }
    }
    if (device) return { state: 'pending', userCode: device.userCode }
    const stored = await activeCredential(broker)
    if (stored) return installationStatus(stored, Boolean(broker))
    if (action !== 'connect') return { state: 'disconnected' }
    const data = await json(deviceReply, deviceHost + '/device/code', { client_id: SELECTION_GITHUB_CLIENT_ID })
    const interval = Math.max(Number(data.interval) || 5, 5) * 1000
    device = { broker, code: data.device_code, userCode: data.user_code, expires: Date.now() + data.expires_in * 1000, interval, nextPoll: Date.now() + interval }
    return { state: 'pending', userCode: device.userCode }
  })
}
