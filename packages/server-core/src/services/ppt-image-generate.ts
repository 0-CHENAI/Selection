/**
 * Presentation images for template slots.
 * Selection 不生成图片（#741 已关闭）：没有注入的生成函数时只写占位，从不伪造配图。
 * 用户图片由技能直接放进图片槽，不经过这里。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  /** 只给测试注入；应用里没有生图提供方。 */
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
  const generator = request.generate
  mkdirSync(join(request.workspaceDir, 'images'), { recursive: true })
  let bytes = PLACEHOLDER_PNG
  let provider = 'placeholder'
  let width = 1
  let height = 1
  let placeholder = true
  let message = 'Selection 不生成图片。有用户图片就原样放进图片位；没有就把这一页换成没有图片位的版式。占位只作最后手段，不要说成已配图。'
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
