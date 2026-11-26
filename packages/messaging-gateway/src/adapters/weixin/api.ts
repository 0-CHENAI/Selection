import { randomBytes } from 'node:crypto'
import gatewayPackage from '../../../package.json'

export const WEIXIN_BASE = 'https://ilinkai.weixin.qq.com'
// Wire reference: @tencent-weixin/openclaw-weixin@2.4.10, src/api/api.ts.
const PROTOCOL_VERSION = '2.4.10'
const clientVersion = PROTOCOL_VERSION.split('.').reduce((v, part) => (v << 8) | Number(part), 0)
const baseInfo = { channel_version: PROTOCOL_VERSION, bot_agent: `Selection/${gatewayPackage.version}` }

export interface WeixinAccount {
  token: string
  botId: string
  userId?: string
  baseUrl: string
}

export function weixinOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.endsWith('.weixin.qq.com')) throw new Error('Invalid WeChat API address')
  return url.origin
}

export class WeixinApiError extends Error {
  constructor(readonly code: number) { super(`WeChat API error (${code})`) }
}

export async function weixinRequest<T>(base: string, path: string, options: {
  body?: object; token?: string; signal?: AbortSignal; timeoutMs?: number
} = {}): Promise<T> {
  const headers: Record<string, string> = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(clientVersion) }
  if (options.body) {
    headers['Content-Type'] = 'application/json'
    headers.AuthorizationType = 'ilink_bot_token'
    headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const body = options.token ? { ...options.body, base_info: baseInfo } : options.body
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000)
  const response = await fetch(`${weixinOrigin(base)}/ilink/bot/${path}`, {
    method: body ? 'POST' : 'GET', headers, redirect: 'error',
    body: body ? JSON.stringify(body) : undefined,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  })
  if (!response.ok) throw new WeixinApiError(response.status)
  // These protobuf uint64 fields may arrive as unquoted integers. Node 22+
  // exposes the original JSON token in the reviver, before Number rounding.
  const data = JSON.parse(await response.text(), (key, value, context?: { source?: string }) => {
    if (typeof value === 'number' && ['message_id', 'msg_id', 'svr_id'].includes(key)) {
      if (!context?.source && !Number.isSafeInteger(value)) throw new Error('Cannot preserve WeChat message ID')
      return context?.source ?? String(value)
    }
    return value
  }) as T & { ret?: number; errcode?: number }
  if (data.ret === -14 || data.errcode === -14) throw new WeixinApiError(-14)
  const errorCode = data.errcode || data.ret
  if (errorCode) throw new WeixinApiError(errorCode)
  return data as T
}
