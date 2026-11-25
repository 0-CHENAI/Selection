import { Worker } from 'node:worker_threads'
import { optimizeImageInProcess } from './image-resize-core.ts'
import type {
  ImageOptimizationResult,
  ImageProcessingFailureCode,
  ImageOptimizerRequest,
  ImageOptimizerWorkerStarted,
  ImageResizeLimits,
} from './image-resize-types.ts'

const FAILURE_CODES = new Set<ImageProcessingFailureCode>([
  'image_runtime_unavailable',
  'image_decode_failed',
  'image_conversion_failed',
  'image_resize_failed',
  'image_size_limit_exceeded',
])
const WORKER_STARTUP_TIMEOUT_MS = 2_000
const PROCESSING_TIMEOUT_MS = 15_000

type WorkerFactory = (specifier: string | URL) => Worker

export interface ImageResizeRunnerDependencies {
  createWorker?: WorkerFactory
  optimizeInProcess?: typeof optimizeImageInProcess
  preferInProcess?: boolean
  workerStartupTimeoutMs?: number
}

function abortError(): Error {
  const error = new Error('Image processing aborted')
  error.name = 'AbortError'
  return error
}

function isOptimizationResult(value: unknown): value is ImageOptimizationResult {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false
  const result = value as Partial<ImageOptimizationResult>
  if (result.ok === false) {
    return typeof result.code === 'string'
      && FAILURE_CODES.has(result.code as ImageProcessingFailureCode)
      && typeof result.detail === 'string'
  }
  if (result.ok !== true) return false
  const success = result as Partial<Extract<ImageOptimizationResult, { ok: true }>>
  const validJpegQuality = success.mimeType === 'image/jpeg'
    ? Number.isInteger(success.jpegQuality)
      && (success.jpegQuality ?? 0) >= 1
      && (success.jpegQuality ?? 0) <= 100
    : (success.mimeType === 'image/png' || success.mimeType === 'image/webp') && success.jpegQuality === undefined
  const dimensionsMatchResizeFlag = success.wasResized === (
    success.width !== success.originalWidth || success.height !== success.originalHeight
  )
  return success.bytes instanceof Uint8Array
    && success.bytes.byteLength > 0
    && (success.mimeType === 'image/png' || success.mimeType === 'image/jpeg' || success.mimeType === 'image/webp')
    && Number.isInteger(success.originalWidth) && (success.originalWidth ?? 0) > 0
    && Number.isInteger(success.originalHeight) && (success.originalHeight ?? 0) > 0
    && Number.isInteger(success.width) && (success.width ?? 0) > 0
    && Number.isInteger(success.height) && (success.height ?? 0) > 0
    && typeof success.wasResized === 'boolean'
    && Number.isInteger(success.encodingAttempts) && (success.encodingAttempts ?? 0) > 0
    && Number.isInteger(success.resizePasses) && (success.resizePasses ?? 0) > 0
    && dimensionsMatchResizeFlag
    && validJpegQuality
}

function isWorkerStarted(value: unknown): value is ImageOptimizerWorkerStarted {
  return !!value && typeof value === 'object' && (value as Partial<ImageOptimizerWorkerStarted>).type === 'started'
}

function imageResizeFailure(prefix: string, error: unknown): ImageOptimizationResult {
  const detail = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'unknown error'
  return {
    ok: false,
    code: 'image_resize_failed',
    detail: `${prefix}: ${detail}`,
  }
}

async function runInWorker(
  inputBytes: Uint8Array,
  mimeType: string,
  limits: ImageResizeLimits,
  signal: AbortSignal | undefined,
  createWorker: WorkerFactory,
  startupTimeoutMs: number,
): Promise<ImageOptimizationResult> {
  if (signal?.aborted) throw abortError()
  const workerFilename = import.meta.url.endsWith('.ts')
    ? 'read-image-resize-worker.ts'
    : 'read-image-resize-worker.js'
  const worker = createWorker(new URL(workerFilename, import.meta.url))
  try {
    const transferredBytes = new Uint8Array(inputBytes)
    const request: ImageOptimizerRequest = { bytes: transferredBytes, mimeType, limits }
    return await new Promise<ImageOptimizationResult>((resolve, reject) => {
      let settled = false
      let processingStarted = false
      let timer: ReturnType<typeof setTimeout>
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = (): void => settle(() => reject(abortError()))
      timer = setTimeout(() => settle(() => reject(new Error('Image resize Worker did not start in time'))), startupTimeoutMs)
      worker.on('message', (message: unknown) => {
        if (settled) return
        if (isWorkerStarted(message)) {
          if (processingStarted) return
          processingStarted = true
          clearTimeout(timer)
          timer = setTimeout(() => settle(() => resolve(
            imageResizeFailure('Image resize Worker timed out', 'No result after processing started'),
          )), PROCESSING_TIMEOUT_MS)
          return
        }
        settle(() => {
          if (!isOptimizationResult(message)) {
            reject(new Error('Invalid image resize worker response'))
            return
          }
          resolve(message)
        })
      })
      worker.once('error', error => settle(() => {
        if (processingStarted) {
          resolve(imageResizeFailure('Image resize Worker failed after processing started', error))
          return
        }
        reject(error)
      }))
      worker.once('exit', code => {
        const error = new Error(`Image resize worker exited before responding with code ${code}`)
        settle(() => {
          if (processingStarted) {
            resolve(imageResizeFailure('Image resize Worker failed after processing started', error))
            return
          }
          reject(error)
        })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      try {
        worker.postMessage(request, [transferredBytes.buffer])
      } catch (error) {
        settle(() => reject(error))
      }
    })
  } finally {
    // A stalled Bun Worker can also stall termination. Release it without holding the reply.
    const termination = worker.terminate()
    worker.unref()
    void termination.catch(() => undefined)
  }
}

export async function runImageOptimizer(
  inputBytes: Uint8Array,
  mimeType: string,
  limits: ImageResizeLimits,
  signal?: AbortSignal,
  dependencies: ImageResizeRunnerDependencies = {},
): Promise<ImageOptimizationResult> {
  if (!dependencies.preferInProcess) {
    try {
      return await runInWorker(
        inputBytes,
        mimeType,
        limits,
        signal,
        dependencies.createWorker ?? (specifier => new Worker(specifier)),
        dependencies.workerStartupTimeoutMs ?? WORKER_STARTUP_TIMEOUT_MS,
      )
    } catch (error) {
      if (signal?.aborted) throw abortError()
      if (error instanceof Error && error.name === 'AbortError') throw error
    }
  }
  if (signal?.aborted) throw abortError()
  const optimizeInProcess = dependencies.optimizeInProcess ?? optimizeImageInProcess
  let onAbort: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<ImageOptimizationResult>((resolve, reject) => {
      onAbort = () => reject(abortError())
      timer = setTimeout(() => reject(new Error('In-process image resize timed out')), PROCESSING_TIMEOUT_MS)
      signal?.addEventListener('abort', onAbort, { once: true })
      void optimizeInProcess(inputBytes, mimeType, limits).then(resolve, reject)
    })
  } catch (error) {
    if (signal?.aborted) throw abortError()
    if (error instanceof Error && error.name === 'AbortError') throw error
    return imageResizeFailure('In-process image resize failed', error)
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}
