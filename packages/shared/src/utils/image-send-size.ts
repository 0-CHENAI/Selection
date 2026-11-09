/**
 * Shared image send-size resolver.
 *
 * Attachments, screenshots, read-tool images, and tool-result images all
 * project through this module before they are encoded. The default is a
 * total-pixel budget (wide and tall images keep their short-edge resolution),
 * with a long-edge cap and no upscaling. DeepSeek connections instead shrink
 * to the provider's 1024-token grid. Connection fields override the defaults;
 * model ids are never consulted.
 */

export const DEFAULT_IMAGE_PIXEL_BUDGET = 2048 * 2048
export const DEFAULT_IMAGE_MAX_DIMENSION = 8192
/** Encoded-byte target for a normalized send image. */
export const DEFAULT_IMAGE_MAX_BYTES = 4 * 1024 * 1024
/** Encoded-byte target when a DeepSeek connection uses the token grid. */
export const DEFAULT_DEEPSEEK_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_ENCODING_QUALITIES = [85, 75, 60] as const
export const DEEPSEEK_MAX_IMAGE_TOKENS = 1024

const PATCH_SIZE = 14
const DOWNSAMPLE_RATIO = 3
const MIN_PIXELS = 544 * 544
const CELL_SIZE = PATCH_SIZE * DOWNSAMPLE_RATIO

export interface ProjectedDimensions {
  width: number
  height: number
}

export interface ImageSendConnection {
  imagePixelBudget?: number
  imageMaxBytes?: number
  imageMaxDimension?: number
  piAuthProvider?: string
  baseUrl?: string
}

export interface ImageSendPolicy {
  /** `deepseek-tokens` shrinks to the 1024-token grid. `pixel-budget` uses `pixelBudget`. */
  mode: 'pixel-budget' | 'deepseek-tokens'
  pixelBudget: number
  maxDimension: number
  maxBytes: number
}

const intDiv = (value: number, divisor: number): number => Math.floor(value / divisor)
const ceilDiv = (value: number, divisor: number): number => Math.floor((value + divisor - 1) / divisor)

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Aspect-preserving integer dimensions within a hard total-pixel budget.
 * The long edge is floored and the short edge is rounded; a while-loop pulls
 * the long edge in if integer rounding still exceeds the budget. Small images
 * are not enlarged.
 */
export function requestImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
): ProjectedDimensions {
  if (!(width > 0) || !(height > 0) || !(maxPixels > 0)) {
    return { width: Math.max(1, Math.floor(width) || 1), height: Math.max(1, Math.floor(height) || 1) }
  }
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  if (scale === 1) return { width, height }
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale))
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale))
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}

/**
 * Aspect-preserving dimensions with an exact long edge. The short edge rounds
 * to the nearest pixel. A long edge at or above the source returns the source.
 */
export function longEdgeDimensions(
  width: number,
  height: number,
  longEdge: number,
): ProjectedDimensions {
  if (!(width > 0) || !(height > 0) || !(longEdge > 0)) {
    return { width: Math.max(1, Math.floor(width) || 1), height: Math.max(1, Math.floor(height) || 1) }
  }
  if (longEdge >= Math.max(width, height)) return { width, height }
  return width >= height
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge * height / width)) }
    : { width: Math.max(1, Math.round(longEdge * width / height)), height: longEdge }
}

interface GridResize {
  readonly gridHeight: number
  readonly gridWidth: number
  readonly bestHeight: number
  readonly bestWidth: number
  readonly numTokens: number
}

function gridTokens(gridHeight: number, gridWidth: number): number {
  return gridHeight * (gridWidth + 1) + 2
}

function gridCells(paddedLength: number): number {
  return ceilDiv(intDiv(paddedLength, PATCH_SIZE), DOWNSAMPLE_RATIO)
}

function solveResizeRatio(height: number, width: number, budget: number): GridResize {
  const aspect = height / width
  const idealGridWidth = Math.sqrt((budget - 2) / aspect + 0.25) - 0.5
  const idealGridHeight = idealGridWidth * aspect
  let bestHeight: number
  let bestWidth: number
  if (idealGridWidth < 1) {
    const solvedGridWidth = 1
    const solvedGridHeight = intDiv(budget - 2, solvedGridWidth + 1)
    bestWidth = solvedGridWidth * CELL_SIZE
    bestHeight = solvedGridHeight * CELL_SIZE
  } else if (idealGridHeight < 1) {
    const solvedGridHeight = 1
    const solvedGridWidth = intDiv(budget - 2, solvedGridHeight) - 1
    bestWidth = solvedGridWidth * CELL_SIZE
    bestHeight = solvedGridHeight * CELL_SIZE
  } else {
    const solvedGridWidth = Math.trunc(idealGridWidth)
    const solvedGridHeight = Math.trunc(idealGridHeight)
    const scale = Math.min(solvedGridWidth * CELL_SIZE / width, solvedGridHeight * CELL_SIZE / height)
    bestWidth = Math.trunc(width * scale / PATCH_SIZE) * PATCH_SIZE
    bestHeight = Math.trunc(height * scale / PATCH_SIZE) * PATCH_SIZE
  }
  const gridHeight = gridCells(bestHeight)
  const gridWidth = gridCells(bestWidth)
  return { gridHeight, gridWidth, bestHeight, bestWidth, numTokens: gridTokens(gridHeight, gridWidth) }
}

function safeResize(height: number, width: number, paddedHeight: number, paddedWidth: number): GridResize {
  const gridHeight = gridCells(paddedHeight)
  const gridWidth = gridCells(paddedWidth)
  const direct: GridResize = {
    gridHeight,
    gridWidth,
    bestHeight: paddedHeight,
    bestWidth: paddedWidth,
    numTokens: gridTokens(gridHeight, gridWidth),
  }
  if (direct.numTokens <= DEEPSEEK_MAX_IMAGE_TOKENS) return direct
  const solved = solveResizeRatio(height, width, DEEPSEEK_MAX_IMAGE_TOKENS)
  if (solved.numTokens > DEEPSEEK_MAX_IMAGE_TOKENS) {
    throw new Error(`deepseek image tokens: no grid fits the token budget for ${width}x${height}`)
  }
  return solved
}

function resizeOnce(width: number, height: number): GridResize {
  let scaledWidth = width
  let scaledHeight = height
  const pixels = scaledWidth * scaledHeight
  if (pixels < MIN_PIXELS && pixels > 0) {
    const scale = Math.sqrt(MIN_PIXELS / pixels)
    scaledWidth = Math.trunc(scaledWidth * scale)
    scaledHeight = Math.trunc(scaledHeight * scale)
  }
  const paddedWidth = ceilDiv(scaledWidth, PATCH_SIZE) * PATCH_SIZE
  const paddedHeight = ceilDiv(scaledHeight, PATCH_SIZE) * PATCH_SIZE
  return safeResize(scaledHeight, scaledWidth, paddedHeight, paddedWidth)
}

function sameResize(a: GridResize, b: GridResize): boolean {
  return a.gridHeight === b.gridHeight
    && a.gridWidth === b.gridWidth
    && a.bestHeight === b.bestHeight
    && a.bestWidth === b.bestWidth
    && a.numTokens === b.numTokens
}

/**
 * Dimensions to encode so DeepSeek keeps the whole image inside 1024 tokens.
 * The source is sent unchanged when its patch-padded grid already fits.
 * Otherwise the source aspect is placed on the solved grid's long edge.
 * Small images are never enlarged.
 */
export function deepSeekRequestImageDimensions(width: number, height: number): ProjectedDimensions {
  if (!(width > 0) || !(height > 0)) {
    return { width: Math.max(1, Math.floor(width) || 1), height: Math.max(1, Math.floor(height) || 1) }
  }
  const paddedWidth = ceilDiv(width, PATCH_SIZE) * PATCH_SIZE
  const paddedHeight = ceilDiv(height, PATCH_SIZE) * PATCH_SIZE
  if (gridTokens(gridCells(paddedHeight), gridCells(paddedWidth)) <= DEEPSEEK_MAX_IMAGE_TOKENS) {
    return { width, height }
  }
  const solved = solveResizeRatio(height, width, DEEPSEEK_MAX_IMAGE_TOKENS)
  return longEdgeDimensions(width, height, width >= height ? solved.bestWidth : solved.bestHeight)
}

/** Vision tokens DeepSeek charges for one request image, at most 1024. */
export function deepSeekImageTokens(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0
  let result = resizeOnce(width, height)
  for (let iteration = 1; iteration < 10; iteration += 1) {
    const next = resizeOnce(result.bestWidth, result.bestHeight)
    if (sameResize(next, result)) return result.numTokens
    result = next
  }
  throw new Error(`deepseek image tokens: resize did not converge for ${width}x${height}`)
}

export function encodingMediaType(hasAlpha: boolean): 'image/webp' | 'image/jpeg' {
  return hasAlpha ? 'image/webp' : 'image/jpeg'
}

/** True when the connection is DeepSeek by auth provider or exact API host. */
export function isDeepSeekImageConnection(connection?: ImageSendConnection | null): boolean {
  if (!connection) return false
  if (connection.piAuthProvider === 'deepseek') return true
  const baseUrl = connection.baseUrl?.trim()
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

/**
 * Resolve the send policy for one connection.
 * An explicit `imagePixelBudget` opts a DeepSeek connection out of the token grid.
 */
export function resolveImageSendPolicy(connection?: ImageSendConnection | null): ImageSendPolicy {
  const deepseekTokens = isDeepSeekImageConnection(connection) && connection?.imagePixelBudget == null
  return {
    mode: deepseekTokens ? 'deepseek-tokens' : 'pixel-budget',
    pixelBudget: positiveInt(connection?.imagePixelBudget ?? DEFAULT_IMAGE_PIXEL_BUDGET, DEFAULT_IMAGE_PIXEL_BUDGET),
    maxDimension: positiveInt(connection?.imageMaxDimension ?? DEFAULT_IMAGE_MAX_DIMENSION, DEFAULT_IMAGE_MAX_DIMENSION),
    maxBytes: positiveInt(
      connection?.imageMaxBytes ?? (deepseekTokens ? DEFAULT_DEEPSEEK_IMAGE_MAX_BYTES : DEFAULT_IMAGE_MAX_BYTES),
      deepseekTokens ? DEFAULT_DEEPSEEK_IMAGE_MAX_BYTES : DEFAULT_IMAGE_MAX_BYTES,
    ),
  }
}

/**
 * Target pixel size for one source image. Never larger than the source.
 * The long-edge cap is applied to the source after the pixel or token projection.
 */
export function resolveImageSendSize(
  width: number,
  height: number,
  policy: ImageSendPolicy = resolveImageSendPolicy(),
): ProjectedDimensions {
  const projected = policy.mode === 'deepseek-tokens'
    ? deepSeekRequestImageDimensions(width, height)
    : requestImageDimensions(width, height, policy.pixelBudget)
  if (Math.max(projected.width, projected.height) > policy.maxDimension) {
    return longEdgeDimensions(width, height, policy.maxDimension)
  }
  return projected
}
