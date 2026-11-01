/**
 * 内置生图提供方：火山方舟 Seedream 与 OpenAI Images。
 * 行为参照 dsh-image-generation 的 provider 合同：同样的默认端点、画幅尺寸和 b64_json 返回；
 * 不转发提供方的原始报错，避免回显 Key 或提示词。
 */

export type ImageProviderId = 'bytedance' | 'openai'

export interface ImageProviderSpec {
  provider: ImageProviderId
  baseUrl: string
  model: string
}

export interface ImageProviderConfig extends ImageProviderSpec {
  key: string
}

export const IMAGE_PROVIDER_DEFAULTS: Readonly<Record<ImageProviderId, { baseUrl: string; model: string }>> = Object.freeze({
  bytedance: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-5-251128' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5' },
})

export const IMAGE_PROVIDER_MODELS: Readonly<Record<ImageProviderId, readonly string[]>> = Object.freeze({
  bytedance: [
    'doubao-seedream-5-0-pro-260628',
    'doubao-seedream-5-0-260128',
    'doubao-seedream-5-0-lite-260128',
    'doubao-seedream-4-5-251128',
    'doubao-seedream-4-0-250828',
  ],
  openai: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'],
})

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const SIZES: Record<ImageProviderId, Record<string, string>> = {
  openai: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536' },
  bytedance: { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2304x1728', '3:4': '1728x2304' },
}

export class ImageProviderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ImageProviderError'
  }
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return value === 'bytedance' || value === 'openai'
}

/** 校验并规范化端点和模型。只接受 HTTPS（本机回环可用 HTTP），不接受带凭据、查询或片段的 URL */
export function normalizeImageProvider(provider: unknown, input: { baseUrl?: unknown; model?: unknown } = {}): ImageProviderSpec {
  if (!isImageProviderId(provider)) throw new ImageProviderError('PROVIDER', '请选择火山方舟 Seedream 或 OpenAI。')
  const defaults = IMAGE_PROVIDER_DEFAULTS[provider]
  const model = String(input.model ?? '').trim() || defaults.model
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) throw new ImageProviderError('MODEL', '模型 ID 无效。')
  let url: URL
  try {
    url = new URL(String(input.baseUrl ?? '').trim() || defaults.baseUrl)
  } catch {
    throw new ImageProviderError('ENDPOINT', 'API 地址无效。')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new ImageProviderError('ENDPOINT', 'API 地址要用 HTTPS，且不能带账号、查询参数或片段。')
  }
  url.pathname = url.pathname.replace(/\/images\/generations\/?$/, '')
  return { provider, baseUrl: url.href.replace(/\/+$/, ''), model }
}

export interface ImageGenerationArgs {
  prompt: string
  style_context?: string
  aspect_ratio: string
  purpose?: string
}

export function imageGenerationBody(spec: ImageProviderSpec, args: ImageGenerationArgs): Record<string, unknown> {
  const prompt = args.prompt.trim()
  const style = (args.style_context ?? '').trim()
  if (!prompt || prompt.length + style.length > 8000) throw new ImageProviderError('PROMPT', '画面描述加风格说明不能为空，也不能超过 8000 字。')
  const size = SIZES[spec.provider][args.aspect_ratio]
  if (!size) throw new ImageProviderError('RATIO', '不支持这个画幅比例。')
  return {
    model: spec.model,
    prompt: [
      prompt,
      style && `Art direction: ${style}`,
      args.purpose && `Intended use: ${args.purpose}`,
      `Compose for ${args.aspect_ratio}. Keep important subjects inside the safe central area for cropping. No text in the image.`,
    ].filter(Boolean).join('\n\n'),
    size,
    ...(spec.provider === 'openai'
      ? { n: 1, quality: 'auto', output_format: 'png' }
      : { response_format: 'b64_json', watermark: false }),
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const STATUS_MESSAGES: Record<number, [string, string]> = {
  400: ['PARAMETERS', '生图提供方拒绝了这组参数。请检查模型 ID 和 API 地址。'],
  401: ['AUTH', 'API Key 无效或已过期。'],
  403: ['PERMISSION', '这个 Key 没有该模型的权限。请在提供方控制台开通模型并完成认证。'],
  404: ['MODEL', '模型或 API 地址不可用。'],
  429: ['QUOTA', '生图提供方的额度或频率已到上限。'],
}

function identifier(value: unknown, key: string): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !(key && value.includes(key)) ? value : undefined
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new ImageProviderError('RESPONSE', '生图提供方返回了空响应。')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) throw new ImageProviderError('TOO_LARGE', '生图提供方的返回超过大小上限。')
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total).toString('utf8'))
  } catch {
    throw new ImageProviderError('RESPONSE', '生图提供方返回的不是有效 JSON。')
  }
}

async function request(url: string, key: string, body: unknown, fetchImpl: FetchLike, timeoutMs: number, maxBytes: number, method: 'GET' | 'POST' = 'POST'): Promise<{ ok: true; json: unknown } | { ok: false; status: number; json: unknown; requestId?: string }> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new ImageProviderError('TIMEOUT', '生图提供方超时，请稍后再试。')
    throw new ImageProviderError('UNAVAILABLE', '连不上生图提供方，请检查网络和 API 地址。')
  }
  if (response.ok) return { ok: true, json: await readJson(response, maxBytes) }
  let json: unknown
  try { json = await readJson(response, 64 * 1024) } catch { json = undefined }
  const requestId = identifier(response.headers.get('x-request-id') ?? response.headers.get('x-tt-logid'), key)
  return { ok: false, status: response.status, json, requestId }
}

function failure(status: number, json: unknown, key: string, requestId?: string): ImageProviderError {
  const error = (json as { error?: { code?: unknown } } | undefined)?.error
  const [code, message] = STATUS_MESSAGES[status] ?? ['PROVIDER_ERROR', '生图提供方没能完成请求。']
  const context = [`HTTP ${status}`, identifier(error?.code, key) && `code=${identifier(error?.code, key)}`, requestId && `request_id=${requestId}`].filter(Boolean).join('；')
  return new ImageProviderError(code, `${message}（${context}）`)
}

/** 生成一张 PNG。返回字节和尺寸 */
export async function generateProviderImage(config: ImageProviderConfig, args: ImageGenerationArgs, fetchImpl: FetchLike = fetch): Promise<{ bytes: Uint8Array; width: number; height: number; provider: string }> {
  const spec = normalizeImageProvider(config.provider, config)
  const body = imageGenerationBody(spec, args)
  const result = await request(`${spec.baseUrl}/images/generations`, config.key, body, fetchImpl, 180_000, Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024 * 1024)
  if (!result.ok) throw failure(result.status, result.json, config.key, result.requestId)
  const b64 = (result.json as { data?: Array<{ b64_json?: unknown }> })?.data?.[0]?.b64_json
  if (typeof b64 !== 'string' || !b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new ImageProviderError('IMAGE', '生图提供方没有返回有效图片。')
  }
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageProviderError('TOO_LARGE', '生成的图片超过 20 MB。')
  const [width, height] = String(body.size).split('x').map(Number)
  return { bytes, width: width ?? 0, height: height ?? 0, provider: `${spec.provider}:${spec.model}` }
}

/**
 * 保存前做一次不生图的连通检查。
 * OpenAI 读取模型元数据；方舟没有公开的模型查询接口，发一个缺 prompt 的请求，只接受「缺少 prompt」这一种 400。
 */
export async function validateImageProvider(config: ImageProviderConfig, fetchImpl: FetchLike = fetch): Promise<'model' | 'connection'> {
  const spec = normalizeImageProvider(config.provider, config)
  if (!config.key.trim()) throw new ImageProviderError('AUTH', '请填写 API Key。')
  if (spec.provider === 'openai') {
    const result = await request(`${spec.baseUrl}/models/${encodeURIComponent(spec.model)}`, config.key, undefined, fetchImpl, 15_000, 2 * 1024 * 1024, 'GET')
    if (!result.ok) throw failure(result.status, result.json, config.key, result.requestId)
    if ((result.json as { id?: unknown })?.id !== spec.model) throw new ImageProviderError('MODEL', '提供方没有返回这个模型。')
    return 'model'
  }
  const result = await request(`${spec.baseUrl}/images/generations`, config.key, { model: spec.model }, fetchImpl, 15_000, 2 * 1024 * 1024)
  if (!result.ok && result.status === 400) {
    const error = (result.json as { error?: { code?: unknown; message?: unknown; param?: unknown } } | undefined)?.error
    const code = typeof error?.code === 'string' ? error.code : ''
    const message = typeof error?.message === 'string' ? error.message : ''
    if (/^(?:MissingParameter|InvalidParameter)(?:\.[A-Za-z]+)?$/.test(code)
      && (error?.param === 'prompt' || /\bprompt\b/i.test(message))
      && /required|missing|empty|not provided|not set|不能为空|必填|缺少/i.test(message)) return 'connection'
  }
  if (!result.ok) throw failure(result.status, result.json, config.key, result.requestId)
  throw new ImageProviderError('RESPONSE', '提供方返回了意外的校验结果。')
}
