import { inspectImageDimensions, processReadImage, type ReadImageProcessingOptions } from './tools/read/image-processing.ts'
import { encodedSize } from './tools/read/image-resize-core.ts'

interface ToolImagePart {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

const TOOL_IMAGE_BATCH_TIMEOUT_MS = 30_000

/**
 * Project image blocks in a proxy tool result through the shared send-size
 * resolver. Office has a saved PNG for every page, so it can report an
 * incomplete visual check when a source image cannot meet the model's limits.
 */
export async function fitToolResultImages<T extends ToolImagePart>(
  parts: readonly T[],
  imageOptions: ReadImageProcessingOptions = {},
  { signal, preferInProcess, enforceModelLimits }: {
    signal?: AbortSignal
    preferInProcess?: boolean
    enforceModelLimits?: boolean
  } = {},
): Promise<{ content: T[]; blockedImages: number }> {
  // Preserve text-only timeout and cancellation results from the bridge.
  if (!parts.some(part => part.type === 'image')) return { content: [...parts], blockedImages: 0 }
  signal?.throwIfAborted()
  const content: T[] = []
  let blockedImages = 0
  const deadline = AbortSignal.timeout(TOOL_IMAGE_BATCH_TIMEOUT_MS)
  const processingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  for (const part of parts) {
    signal?.throwIfAborted()
    if (part.type !== 'image' || typeof part.data !== 'string' || !part.mimeType) {
      content.push(part)
      continue
    }
    const bytes = Buffer.from(part.data, 'base64')
    let processed: Awaited<ReturnType<typeof processReadImage>> | undefined
    try {
      if (!deadline.aborted) {
        processed = await processReadImage(bytes, part.mimeType, imageOptions, { runner: { preferInProcess } }, processingSignal)
      }
    } catch {
      signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
    if (processed?.ok) {
      if (processed.hints.length > 0) {
        content.push({ type: 'text', text: processed.hints.join('\n') } as T)
      }
      content.push({ ...part, data: processed.data, mimeType: processed.mimeType })
    } else if (enforceModelLimits && exceedsModelLimits(bytes, part.mimeType, imageOptions)) {
      blockedImages++
      content.push({
        type: 'text',
        text: 'Visual inspection is incomplete for this page. Its original PNG was saved at the path above. Switch to an image-capable model with a larger image limit and inspect it there.',
      } as T)
    } else {
      content.push(part)
    }
  }
  return { content, blockedImages }
}

function exceedsModelLimits(bytes: Uint8Array, mimeType: string, options: ReadImageProcessingOptions): boolean {
  if (options.maxEncodedBytes !== undefined && encodedSize(bytes.byteLength) >= options.maxEncodedBytes) return true
  if (options.maxWidth === undefined && options.maxHeight === undefined) return false
  const size = inspectImageDimensions(bytes, mimeType)
  return !size || size.width > (options.maxWidth ?? Infinity) || size.height > (options.maxHeight ?? Infinity)
}

export function mergeSummarizedToolResult<T extends { type: string }>(
  summarizedText: string,
  originalContent: readonly T[],
): Array<{ type: 'text'; text: string } | T> {
  const images = originalContent.filter(part => part.type === 'image')
  return [{ type: 'text', text: summarizedText }, ...images]
}
