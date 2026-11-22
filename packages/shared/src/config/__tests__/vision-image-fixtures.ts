import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const value of bytes) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

/**
 * Tiny unique PNG whose raw bytes (and therefore sha256) identify one test image.
 * 1×1 stays under Pi's resize limits so session.prompt / processImage keep the bytes.
 */
export function uniquePng(marker: string): Buffer {
  const rgb = createHash('sha256').update(marker).digest().subarray(0, 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.concat([Buffer.from([0]), rgb])
  const text = Buffer.concat([Buffer.from('Comment\0'), Buffer.from(marker, 'utf8')])
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export function imageSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function imageBlock(marker: string): { type: 'image'; data: string; mimeType: 'image/png'; bytes: Buffer; sha256: string } {
  const bytes = uniquePng(marker)
  return {
    type: 'image',
    data: bytes.toString('base64'),
    mimeType: 'image/png',
    bytes,
    sha256: imageSha256(bytes),
  }
}

export interface CapturedOutboundImage {
  protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai' | 'unknown'
  mimeType?: string
  bytes: Buffer
  sha256: string
  contentIsArray: boolean
}

function pushDataUrl(images: CapturedOutboundImage[], protocol: CapturedOutboundImage['protocol'], url: unknown, contentIsArray: boolean): void {
  if (typeof url !== 'string' || !url.startsWith('data:')) return
  const match = url.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match?.[1] || !match[2]) return
  const bytes = Buffer.from(match[2], 'base64')
  images.push({
    protocol,
    mimeType: match[1],
    bytes,
    sha256: imageSha256(bytes),
    contentIsArray,
  })
}

function pushBase64(images: CapturedOutboundImage[], protocol: CapturedOutboundImage['protocol'], mimeType: unknown, data: unknown, contentIsArray: boolean): void {
  if (typeof data !== 'string' || data.length < 8) return
  const bytes = Buffer.from(data, 'base64')
  images.push({
    protocol,
    mimeType: typeof mimeType === 'string' ? mimeType : undefined,
    bytes,
    sha256: imageSha256(bytes),
    contentIsArray,
  })
}

/** Collect image bytes from a provider JSON body. Does not trust UI thumbnails. */
export function collectOutboundImages(body: Record<string, unknown>): CapturedOutboundImage[] {
  const images: CapturedOutboundImage[] = []

  const messages = body.messages
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const content = (message as { content?: unknown }).content
      const contentIsArray = Array.isArray(content)
      if (typeof content === 'string') {
        expectStringifiedVision(content)
        continue
      }
      if (!contentIsArray) continue
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const block = part as Record<string, unknown>
        if (block.type === 'image_url') {
          const imageUrl = block.image_url
          const url = typeof imageUrl === 'string' ? imageUrl : (imageUrl as { url?: unknown } | undefined)?.url
          pushDataUrl(images, 'openai-completions', url, true)
        } else if (block.type === 'image' && block.source && typeof block.source === 'object') {
          const source = block.source as { type?: unknown; media_type?: unknown; data?: unknown }
          if (source.type === 'base64') pushBase64(images, 'anthropic-messages', source.media_type, source.data, true)
        }
      }
    }
  }

  const input = body.input
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue
      const content = (entry as { content?: unknown }).content
      const contentIsArray = Array.isArray(content)
      if (!contentIsArray) continue
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const block = part as Record<string, unknown>
        if (block.type === 'input_image') pushDataUrl(images, 'openai-responses', block.image_url, true)
      }
    }
  }

  const contents = body.contents
  if (Array.isArray(contents)) {
    for (const entry of contents) {
      if (!entry || typeof entry !== 'object') continue
      const parts = (entry as { parts?: unknown }).parts
      if (!Array.isArray(parts)) continue
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue
        const inline = (part as { inlineData?: { mimeType?: unknown; data?: unknown } }).inlineData
        if (inline) pushBase64(images, 'google-generative-ai', inline.mimeType, inline.data, true)
      }
    }
  }

  return images
}

function expectStringifiedVision(content: string): void {
  if (content.includes('image_url') || content.includes('input_image')) {
    throw new Error(`Vision content was stringified instead of sent as a JSON array: ${content.slice(0, 180)}`)
  }
}
