import { resolveImageSendPolicy, type ImageSendPolicy } from '../../shared/src/utils/image-send-size.ts'
import { processReadImage } from './tools/read/image-processing.ts'

interface ToolImagePart {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

/**
 * Project image blocks in a proxy tool result through the shared send-size
 * resolver. A part that cannot be decoded is left unchanged.
 */
export async function fitToolResultImages<T extends ToolImagePart>(
  parts: readonly T[],
  policy: ImageSendPolicy = resolveImageSendPolicy(),
): Promise<T[]> {
  const fitted: T[] = []
  for (const part of parts) {
    if (part.type !== 'image' || typeof part.data !== 'string' || !part.mimeType) {
      fitted.push(part)
      continue
    }
    try {
      const processed = await processReadImage(Buffer.from(part.data, 'base64'), part.mimeType, { policy })
      if (!processed.ok) {
        fitted.push(part)
        continue
      }
      if (processed.hints.length > 0) {
        fitted.push({ type: 'text', text: processed.hints.join('\n') } as T)
      }
      fitted.push({ ...part, data: processed.data, mimeType: processed.mimeType })
    } catch {
      fitted.push(part)
    }
  }
  return fitted
}

export function mergeSummarizedToolResult<T extends { type: string }>(
  summarizedText: string,
  originalContent: readonly T[],
): Array<{ type: 'text'; text: string } | T> {
  const images = originalContent.filter(part => part.type === 'image')
  return [{ type: 'text', text: summarizedText }, ...images]
}
