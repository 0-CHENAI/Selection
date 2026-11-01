/**
 * Presentation images for template slots.
 * No configured provider means a named placeholder, never a forged picture.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const IMAGE_GENERATE_LIMIT = 12
const PLACEHOLDER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])

export interface ImageGenerateRequest {
  purpose: 'presentation' | 'document' | 'other'
  aspect_ratio: string
  style_context: string
  prompt: string
  reuse_group?: string
  source_policy?: 'contextual-scene' | 'provided-portrait' | 'native-graphic'
  workspaceDir: string
  sessionDir: string
  configDir?: string
  generate?: (request: ImageGenerateRequest) => Promise<{ bytes: Uint8Array; provider: string; width: number; height: number }>
}

export interface ImageGenerateResult {
  status: 'generated' | 'reused' | 'placeholder' | 'limit' | 'refused'
  path?: string
  placeholder: boolean
  provider?: string
  prompt: string
  aspect_ratio: string
  width?: number
  height?: number
  message: string
  remaining: number
}

interface ImageLog {
  count: number
  groups: Record<string, { path: string; sha256: string; prompt: string; provider: string; aspect_ratio: string }>
}

function logPath(sessionDir: string): string {
  return join(sessionDir, 'data', 'image-generate.json')
}

function readLog(sessionDir: string): ImageLog {
  try {
    const parsed = JSON.parse(readFileSync(logPath(sessionDir), 'utf8')) as ImageLog
    if (!parsed || typeof parsed !== 'object' || typeof parsed.count !== 'number' || !parsed.groups) return { count: 0, groups: {} }
    return parsed
  } catch {
    return { count: 0, groups: {} }
  }
}

function writeLog(sessionDir: string, log: ImageLog): void {
  mkdirSync(join(sessionDir, 'data'), { recursive: true })
  writeFileSync(logPath(sessionDir), `${JSON.stringify(log, null, 2)}\n`)
}

function configProvider(configDir: string): { provider: string; endpoint: string } | undefined {
  const path = join(configDir, 'image-generation.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { provider?: unknown; endpoint?: unknown }
    if (typeof parsed.endpoint !== 'string' || !/^https:\/\//.test(parsed.endpoint)) return undefined
    return { provider: typeof parsed.provider === 'string' && parsed.provider.trim() ? parsed.provider.trim() : 'custom', endpoint: parsed.endpoint }
  } catch {
    return undefined
  }
}

async function callEndpoint(endpoint: string, provider: string, request: ImageGenerateRequest): Promise<{ bytes: Uint8Array; provider: string; width: number; height: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (process.env.SELECTION_IMAGE_API_KEY) headers.authorization = `Bearer ${process.env.SELECTION_IMAGE_API_KEY}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      purpose: request.purpose,
      aspect_ratio: request.aspect_ratio,
      style_context: request.style_context,
      prompt: request.prompt,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`生图提供方返回 ${response.status}`)
  const body = await response.json() as { image_base64?: unknown; provider?: unknown; width?: unknown; height?: unknown }
  if (typeof body.image_base64 !== 'string' || !body.image_base64) throw new Error('生图提供方没有返回图片')
  return {
    bytes: Buffer.from(body.image_base64, 'base64'),
    provider: typeof body.provider === 'string' && body.provider ? body.provider : provider,
    width: typeof body.width === 'number' ? body.width : 0,
    height: typeof body.height === 'number' ? body.height : 0,
  }
}

export async function generatePresentationImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
  if (!ASPECTS.has(request.aspect_ratio)) throw new Error('图片比例无效')
  if (!request.prompt.trim() || request.prompt.length > 4000) throw new Error('画面描述无效')
  if (!request.style_context.trim()) throw new Error('需要写上全稿风格，包括图片内文字数量为 0')
  if (request.source_policy === 'provided-portrait') {
    return { status: 'refused', placeholder: false, prompt: request.prompt, aspect_ratio: request.aspect_ratio, remaining: IMAGE_GENERATE_LIMIT, message: '人物照片只用用户提供的照片，不要生图。' }
  }
  if (request.source_policy === 'native-graphic') {
    return { status: 'refused', placeholder: false, prompt: request.prompt, aspect_ratio: request.aspect_ratio, remaining: IMAGE_GENERATE_LIMIT, message: 'native-graphic 用已核实的数据画原生图表，不要生图。' }
  }
  const log = readLog(request.sessionDir)
  const group = request.reuse_group?.trim()
  if (group && log.groups[group] && existsSync(log.groups[group]!.path)) {
    const saved = log.groups[group]!
    return { status: 'reused', path: saved.path, placeholder: /selection-placeholder-/i.test(saved.path), provider: saved.provider, prompt: saved.prompt, aspect_ratio: saved.aspect_ratio, remaining: Math.max(0, IMAGE_GENERATE_LIMIT - log.count), message: `复用了同一组「${group}」的图片，没有再次生图。` }
  }
  if (log.count >= IMAGE_GENERATE_LIMIT) {
    return { status: 'limit', placeholder: false, prompt: request.prompt, aspect_ratio: request.aspect_ratio, remaining: 0, message: `这份稿件的生图次数已到上限（${IMAGE_GENERATE_LIMIT}）。请复用已有图片，或改用用户提供的图片。` }
  }
  const configDir = request.configDir ?? process.env.CRAFT_CONFIG_DIR ?? join(homedir(), '.selection')
  const configured = configProvider(configDir)
  const generator = request.generate ?? (configured ? (input: ImageGenerateRequest) => callEndpoint(configured.endpoint, configured.provider, input) : undefined)
  mkdirSync(join(request.workspaceDir, 'images'), { recursive: true })
  let bytes = PLACEHOLDER_PNG
  let provider = 'placeholder'
  let width = 1
  let height = 1
  let placeholder = true
  let message = '没有可用的生图提供方。槽位保留占位图，请配置 image-generation.json，或改用用户图片。不要把占位说成已配图。'
  if (generator) {
    const generated = await generator(request)
    if (!generated.bytes.byteLength) throw new Error('生图提供方返回了空文件')
    bytes = Buffer.from(generated.bytes)
    provider = generated.provider
    width = generated.width
    height = generated.height
    placeholder = false
    message = '已写入工作区。请把路径填进图片槽，保持边界和遮罩，再用 office_render 看整页。'
  }
  const stamp = createHash('sha256').update(`${group ?? request.prompt}\n${request.aspect_ratio}`).digest('hex').slice(0, 12)
  const fileName = placeholder ? `selection-placeholder-${stamp}.png` : `generated-${stamp}.png`
  const path = join(request.workspaceDir, 'images', fileName)
  writeFileSync(path, bytes)
  const digest = createHash('sha256').update(bytes).digest('hex')
  log.count += 1
  if (group) log.groups[group] = { path, sha256: digest, prompt: request.prompt, provider, aspect_ratio: request.aspect_ratio }
  writeLog(request.sessionDir, log)
  return {
    status: placeholder ? 'placeholder' : 'generated',
    path,
    placeholder,
    provider,
    prompt: request.prompt,
    aspect_ratio: request.aspect_ratio,
    width,
    height,
    message,
    remaining: IMAGE_GENERATE_LIMIT - log.count,
  }
}
