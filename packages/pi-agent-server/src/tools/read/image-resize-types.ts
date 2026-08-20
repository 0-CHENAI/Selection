export const DEFAULT_MAX_WIDTH = 2560
export const DEFAULT_MAX_HEIGHT = 2560
export const DEFAULT_MAX_ENCODED_BYTES = 4.5 * 1024 * 1024
export const DEFAULT_JPEG_QUALITY = 85
export const MIN_JPEG_QUALITY = 70
export const MAX_RESIZE_PASSES = 6

export type ImageProcessingFailureCode =
  | 'image_runtime_unavailable'
  | 'image_decode_failed'
  | 'image_conversion_failed'
  | 'image_resize_failed'
  | 'image_size_limit_exceeded'

export interface ImageResizeLimits {
  maxWidth: number
  maxHeight: number
  maxEncodedBytes: number
  jpegQuality: number
}

export type ImageOptimizationResult =
  | {
      ok: true
      bytes: Uint8Array
      mimeType: 'image/png' | 'image/jpeg'
      originalWidth: number
      originalHeight: number
      width: number
      height: number
      wasResized: boolean
      jpegQuality?: number
      encodingAttempts: number
      resizePasses: number
    }
  | {
      ok: false
      code: ImageProcessingFailureCode
      detail: string
    }

export interface ImageOptimizerRequest {
  bytes: Uint8Array
  mimeType: string
  limits: ImageResizeLimits
}

export interface ImageOptimizerWorkerStarted {
  type: 'started'
}
