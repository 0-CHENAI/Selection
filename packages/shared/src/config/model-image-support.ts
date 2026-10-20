/**
 * Custom-endpoint image capability helpers.
 *
 * Stored model IDs (Opus) and runtime IDs (pi/Opus, custom-endpoint/Opus)
 * must compare as the same model, or vision flags never apply at send time.
 */

const PROVIDER_PREFIXES = ['pi/', 'custom-endpoint/']

export function normalizeConnectionModelId(id: string): string {
  let value = id.trim()
  for (const prefix of PROVIDER_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length)
    }
  }
  return value
}

export function connectionModelIdsMatch(a: string, b: string): boolean {
  const left = normalizeConnectionModelId(a)
  const right = normalizeConnectionModelId(b)
  if (!left || !right) return false
  return left === right || left.toLowerCase() === right.toLowerCase()
}

// Bounded tokens so `octopus`, `omnibox`, and `foo-vllm` are not treated as vision names.
const VISION_TOKEN = /(?:^|[^a-z0-9])(?:opus|sonnet|haiku|claude|gemini|pixtral|internvl|omni|multimodal|vision|llama-4|gemma-3|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|qwen-vl|qwen2\.5-vl|qwen2-vl)(?:[^a-z0-9]|$)/
const VL_AFFIX = /(?:^|[.-])vl(?:[^a-z]|$)/

/**
 * Names that accept images but do not match the family regex.
 * `laufry` is the ORDER vision model. `deepseek-flash` (and its v4-flash alias)
 * declare image input in the pinned Pi catalog, so auto sends images and can
 * still learn a rejection.
 */
const KNOWN_VISION_IDS = new Set(['laufry', 'deepseek-flash', 'deepseek-v4-flash'])

/** Official DeepSeek chat ids that do not accept images. Flash aliases are excluded above. */
const DEEPSEEK_TEXT_ONLY = /^(?:deepseek-chat|deepseek-reasoner|deepseek-v4(?:[.-].+)?)$/

export type ImageSupportMode = 'auto' | 'on' | 'off'
export type ImageSupportSource = 'explicit' | 'learned' | 'endpoint' | 'known' | 'optimistic'

export interface ModelImageRecord {
  id: string
  name?: string
  shortName?: string
  supportsImages?: boolean
  imageSupport?: ImageSupportMode
  learnedSupportsImages?: boolean
}

export interface ImageSupportResolution {
  /** Whether this attempt should include images. */
  supportsImages: boolean
  /** Stored user choice. Absent legacy booleans collapse to on/off. */
  mode: ImageSupportMode
  source: ImageSupportSource
  /**
   * The provider may reject this attempt. A rejection can be retried once
   * without images and remembered. Explicit on/off is not learnable.
   */
  learnable: boolean
}

function bareModelId(id: string): string {
  return normalizeConnectionModelId(id).toLowerCase()
}

function isDeepSeekTextOnlyId(id: string): boolean {
  if (id === 'deepseek-flash' || id === 'deepseek-v4-flash') return false
  return DEEPSEEK_TEXT_ONLY.test(id)
}

/**
 * Known capability for auto mode.
 * `true` / `false` are table defaults. `undefined` means the table has no opinion.
 */
export function lookupKnownModelImageSupport(id: string, name?: string): boolean | undefined {
  const bare = bareModelId(id)
  const display = (name ?? '').trim().toLowerCase()
  const ids = display && display !== bare ? [bare, display] : [bare]
  if (ids.some(value => KNOWN_VISION_IDS.has(value))) return true
  if (ids.some(value => isDeepSeekTextOnlyId(value))) return false
  const haystack = `${bare} ${display}`.trim()
  if (VISION_TOKEN.test(haystack) || VL_AFFIX.test(haystack)) return true
  return undefined
}

/**
 * Positive name heuristic kept for callers that only need "this looks like a
 * vision model". Unknown and known text-only names are false. Send-time
 * decisions go through {@link resolveModelImageSupportFromCatalog}.
 */
export function inferModelSupportsImages(id: string, name?: string): boolean {
  return lookupKnownModelImageSupport(id, name) === true
}

export function readStoredImageSupport(
  model: string | Pick<ModelImageRecord, 'supportsImages' | 'imageSupport' | 'learnedSupportsImages'> | undefined,
): { mode: ImageSupportMode; learnedSupportsImages?: boolean } {
  if (!model || typeof model === 'string') return { mode: 'auto' }
  const learned = typeof model.learnedSupportsImages === 'boolean' ? model.learnedSupportsImages : undefined
  if (model.imageSupport === 'on' || model.imageSupport === 'off' || model.imageSupport === 'auto') {
    return {
      mode: model.imageSupport,
      ...(model.imageSupport === 'auto' && learned !== undefined ? { learnedSupportsImages: learned } : {}),
    }
  }
  if (model.supportsImages === true) return { mode: 'on' }
  if (model.supportsImages === false) return { mode: 'off' }
  return learned === undefined ? { mode: 'auto' } : { mode: 'auto', learnedSupportsImages: learned }
}

export function resolveModelImageSupportFromCatalog(input: {
  modelId: string
  modelName?: string
  models?: ReadonlyArray<string | ModelImageRecord>
  endpointSupportsImages?: boolean
}): ImageSupportResolution {
  const entry = input.models?.find(model => {
    const id = typeof model === 'string' ? model : model.id
    return connectionModelIdsMatch(id, input.modelId)
  })
  const stored = readStoredImageSupport(entry)
  const entryName = entry && typeof entry !== 'string' ? entry.name : undefined
  const modelName = input.modelName || entryName

  if (stored.mode === 'on' || stored.mode === 'off') {
    return {
      supportsImages: stored.mode === 'on',
      mode: stored.mode,
      source: 'explicit',
      learnable: false,
    }
  }
  if (typeof stored.learnedSupportsImages === 'boolean') {
    return {
      supportsImages: stored.learnedSupportsImages,
      mode: 'auto',
      source: 'learned',
      learnable: false,
    }
  }
  if (typeof input.endpointSupportsImages === 'boolean') {
    return {
      supportsImages: input.endpointSupportsImages,
      mode: 'auto',
      source: 'endpoint',
      learnable: input.endpointSupportsImages,
    }
  }
  const known = lookupKnownModelImageSupport(input.modelId, modelName)
  if (typeof known === 'boolean') {
    return {
      supportsImages: known,
      mode: 'auto',
      source: 'known',
      learnable: known,
    }
  }
  return {
    supportsImages: true,
    mode: 'auto',
    source: 'optimistic',
    learnable: true,
  }
}

/** Note appended to the model prompt when images are removed from a turn. */
export function buildSkippedImagesNote(imageCount: number): string {
  const count = Math.max(0, Math.floor(imageCount))
  const noun = count === 1 ? 'image' : 'images'
  return `[Image input unavailable: the user attached ${count} ${noun} that this model cannot view. Answer from the text only.]`
}

/**
 * Provider rejection that specifically means image input is unsupported.
 * A bare HTTP 400 is not enough. Corrupt-file and missing-byte errors are not.
 */
export function isUnsupportedImageInputError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  if (!message.trim()) return false
  if (/unsupported image format|invalid image format|invalid image data|corrupt image|failed to decode|image_bytes_unavailable|image_unsupported_format|image_resource_expired/.test(message)) {
    return false
  }
  const mentionsImage = /image_url|input_image|image input|image content|vision|multimodal|multi-modal|图像|图片|多模态/.test(message)
    || /(?:^|[^a-z])images?(?:[^a-z]|$)/.test(message)
  if (!mentionsImage) return false
  const mentionsReject = /unsupported|not support|does not support|doesn't support|do not support|cannot accept|can't accept|cannot process|can't process|not allowed|not enabled|invalid|unrecognized|unknown content|content type|only support|text[- ]only|modalit|不支持|无法接受|不接受/.test(message)
  if (!mentionsReject) return false
  return true
}

export interface UnsupportedImageRetryPlan {
  message: string
  learn: boolean
}

/**
 * One text-only retry of the same model request, before any tool has run.
 * Explicit on/off and a second failure do not retry.
 */
export function planUnsupportedImageRetry(input: {
  error: unknown
  message: string
  imageCount: number
  toolsStarted: boolean
  alreadyRetried: boolean
  learnable: boolean
}): UnsupportedImageRetryPlan | null {
  if (input.alreadyRetried || input.toolsStarted || input.imageCount < 1 || !input.learnable) return null
  if (!isUnsupportedImageInputError(input.error)) return null
  const note = buildSkippedImagesNote(input.imageCount)
  const message = input.message.includes(note) ? input.message : `${input.message}\n\n${note}`
  return { message, learn: true }
}

function modelIdOf(model: string | ModelImageRecord): string {
  return typeof model === 'string' ? model : model.id
}

function withoutLearnedFlag<T extends ModelImageRecord>(model: T): T {
  const next = { ...model }
  delete next.learnedSupportsImages
  return next
}

/**
 * Remember that this connection+model rejected image input.
 * Explicit on/off is left alone. Auto stays auto.
 */
export function learnModelRejectsImages<T extends { models?: Array<string | ModelImageRecord> }>(
  connection: T,
  modelId: string,
): T {
  const models = connection.models ? [...connection.models] : []
  const index = models.findIndex(model => connectionModelIdsMatch(modelIdOf(model), modelId))
  if (index === -1) {
    models.push({ id: modelId, imageSupport: 'auto', learnedSupportsImages: false })
    return { ...connection, models }
  }
  const current = models[index]!
  const stored = readStoredImageSupport(current)
  if (stored.mode === 'on' || stored.mode === 'off') return connection
  if (stored.learnedSupportsImages === false) return connection
  const base: ModelImageRecord = typeof current === 'string'
    ? { id: current, name: current }
    : { ...current }
  models[index] = { ...base, imageSupport: 'auto', learnedSupportsImages: false }
  return { ...connection, models }
}

/** Set the per-model 自动/开/关 choice. Auto clears a learned result. */
export function setModelImageSupport<T extends { models?: Array<string | ModelImageRecord> }>(
  connection: T,
  modelId: string,
  mode: ImageSupportMode,
): T {
  if (!connection.models) return connection
  const models = [...connection.models]
  const index = models.findIndex(model => connectionModelIdsMatch(modelIdOf(model), modelId))
  if (index === -1) return connection
  const current = models[index]!
  if (mode === 'auto') {
    const base: ModelImageRecord = typeof current === 'string'
      ? { id: current, name: current, shortName: current }
      : withoutLearnedFlag({ ...current })
    delete base.supportsImages
    base.imageSupport = 'auto'
    models[index] = base
    return { ...connection, models }
  }
  const enabled = mode === 'on'
  const base: ModelImageRecord = typeof current === 'string'
    ? { id: current, name: current, shortName: current }
    : withoutLearnedFlag({ ...current })
  models[index] = { ...base, supportsImages: enabled, imageSupport: mode }
  return { ...connection, models }
}

/**
 * Copy image input onto a model definition the SDK will actually send.
 * Pi drops images when `input` lacks `image` instead of asking the provider.
 */
export function alignModelImageInput<T extends { input?: readonly string[] }>(
  model: T,
  supportsImages: boolean,
): T {
  const input = model.input ? [...model.input] : ['text']
  const hasImage = input.includes('image')
  if (supportsImages && !hasImage) return { ...model, input: [...input, 'image'] }
  if (!supportsImages && hasImage) {
    const next = input.filter(item => item !== 'image')
    return { ...model, input: next.length > 0 ? next : ['text'] }
  }
  return model
}

export const DEFAULT_CUSTOM_CONTEXT_WINDOW = 131_072
export const DEFAULT_CUSTOM_MAX_TOKENS = 8_192
export const MIN_CUSTOM_CONTEXT_WINDOW = 1_024
export const MAX_CUSTOM_CONTEXT_WINDOW = 10_000_000
export const MIN_CUSTOM_MAX_TOKENS = 256
export const MAX_CUSTOM_MAX_TOKENS = 1_000_000

function readTokenCount(value: unknown): number | undefined {
  const raw = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const tokens = Math.floor(raw)
  return tokens > 0 ? tokens : undefined
}

/** Visible / stored custom-endpoint context window, if it is in range. */
export function sanitizeCustomContextWindow(value: unknown): number | undefined {
  const tokens = readTokenCount(value)
  if (tokens === undefined || tokens < MIN_CUSTOM_CONTEXT_WINDOW || tokens > MAX_CUSTOM_CONTEXT_WINDOW) {
    return undefined
  }
  return tokens
}

/** Visible / stored custom-endpoint max output, clamped to the context window when known. */
export function sanitizeCustomMaxTokens(value: unknown, contextWindow?: number): number | undefined {
  const tokens = readTokenCount(value)
  if (tokens === undefined || tokens < MIN_CUSTOM_MAX_TOKENS || tokens > MAX_CUSTOM_MAX_TOKENS) {
    return undefined
  }
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    const clamped = Math.min(tokens, Math.floor(contextWindow))
    return clamped < MIN_CUSTOM_MAX_TOKENS ? undefined : clamped
  }
  return tokens
}

export type CustomEndpointModelSource =
  | string
  | {
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
      supportedThinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
      thinkingMode?: 'unsupported' | 'always-on' | 'levels';
  supportsImages?: boolean
  imageSupport?: ImageSupportMode
  learnedSupportsImages?: boolean
    }

export type CustomEndpointModelPayload =
  | string
  | {
      id: string
      contextWindow?: number
      maxTokens?: number
      supportedThinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
      thinkingMode?: 'unsupported' | 'always-on' | 'levels';
  supportsImages?: boolean
  imageSupport?: ImageSupportMode
  learnedSupportsImages?: boolean
    }

/**
 * Shape sent to the Pi subprocess. Only explicit stored flags are forwarded
 * so connection-level `customEndpoint.supportsImages` remains authoritative.
 * Name inference happens later in `buildCustomEndpointModelDef`.
 */
export function toCustomEndpointModelPayload(
  model: CustomEndpointModelSource,
): CustomEndpointModelPayload {
  const id = typeof model === 'string' ? model : model.id
  const contextWindow = typeof model === 'string' ? undefined : model.contextWindow
  const maxTokens = typeof model === 'string' ? undefined : model.maxTokens
  const explicit = typeof model === 'object' && typeof model.supportsImages === 'boolean'
    ? model.supportsImages
    : undefined
  const imageSupport = typeof model === 'object'
    && (model.imageSupport === 'auto' || model.imageSupport === 'on' || model.imageSupport === 'off')
    ? model.imageSupport
    : undefined
  const learnedSupportsImages = typeof model === 'object' && typeof model.learnedSupportsImages === 'boolean'
    ? model.learnedSupportsImages
    : undefined
  const supportedThinkingLevels = typeof model === 'string' ? undefined : model.supportedThinkingLevels
  const thinkingMode = typeof model === 'string' ? undefined : model.thinkingMode
  if (
    contextWindow || maxTokens || explicit !== undefined || imageSupport || learnedSupportsImages !== undefined
    || supportedThinkingLevels !== undefined || thinkingMode
  ) {
    return {
      id,
      ...(thinkingMode ? { thinkingMode } : {}),
      ...(supportedThinkingLevels !== undefined ? { supportedThinkingLevels } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(explicit !== undefined ? { supportsImages: explicit } : {}),
      ...(imageSupport ? { imageSupport } : {}),
      ...(learnedSupportsImages !== undefined ? { learnedSupportsImages } : {}),
    }
  }
  return id
}

function resolveStoredTokenLimit(
  models: Array<string | { id: string; contextWindow?: number; maxTokens?: number }> | undefined,
  modelId: string,
  field: 'contextWindow' | 'maxTokens',
): number | undefined {
  if (!models?.length || !modelId) return undefined
  const match = models.find((model) => {
    const id = typeof model === 'string' ? model : model.id
    return connectionModelIdsMatch(id, modelId)
  })
  if (!match || typeof match === 'string') return undefined
  return field === 'contextWindow'
    ? sanitizeCustomContextWindow(match[field])
    : sanitizeCustomMaxTokens(match[field])
}

/** Stored catalog window for a custom-endpoint model, if one was persisted. */
export function resolveCustomModelContextWindow(
  models: Array<string | { id: string; contextWindow?: number }> | undefined,
  modelId: string,
): number | undefined {
  return resolveStoredTokenLimit(models, modelId, 'contextWindow')
}

/** Stored max output tokens for a custom-endpoint model, if one was persisted. */
export function resolveCustomModelMaxTokens(
  models: Array<string | { id: string; maxTokens?: number }> | undefined,
  modelId: string,
): number | undefined {
  return resolveStoredTokenLimit(models, modelId, 'maxTokens')
}
