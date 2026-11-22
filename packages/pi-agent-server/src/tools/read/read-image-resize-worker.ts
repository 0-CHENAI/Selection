import { parentPort } from 'node:worker_threads'
import { optimizeImageInProcess } from './image-resize-core.ts'
import type {
  ImageOptimizationResult,
  ImageOptimizerRequest,
  ImageOptimizerWorkerStarted,
} from './image-resize-types.ts'

function isRequest(value: unknown): value is ImageOptimizerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<ImageOptimizerRequest>
  return request.bytes instanceof Uint8Array
    && typeof request.mimeType === 'string'
    && !!request.limits
    && Number.isInteger(request.limits.maxWidth) && request.limits.maxWidth > 0
    && Number.isInteger(request.limits.maxHeight) && request.limits.maxHeight > 0
    && Number.isInteger(request.limits.maxEncodedBytes) && request.limits.maxEncodedBytes > 0
    && Number.isInteger(request.limits.jpegQuality)
    && request.limits.jpegQuality >= 1
    && request.limits.jpegQuality <= 100
}

const port = parentPort
if (!port) throw new Error('image resize worker requires parentPort')

function toTransferableOutput(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  return new Uint8Array(bytes)
}

port.once('message', (message: unknown) => {
  void (async () => {
    try {
      let result: ImageOptimizationResult
      if (!isRequest(message)) {
        result = {
          ok: false,
          code: 'image_resize_failed',
          detail: 'Invalid image resize worker request.',
        }
      } else {
        const started: ImageOptimizerWorkerStarted = { type: 'started' }
        port.postMessage(started)
        result = await optimizeImageInProcess(message.bytes, message.mimeType, message.limits)
      }

      if (!result.ok) {
        port.postMessage(result)
        return
      }
      const bytes = toTransferableOutput(result.bytes)
      port.postMessage({ ...result, bytes }, [bytes.buffer])
    } catch (error) {
      const failure: ImageOptimizationResult = {
        ok: false,
        code: 'image_resize_failed',
        detail: error instanceof Error ? error.message : String(error),
      }
      port.postMessage(failure)
    }
  })()
})
