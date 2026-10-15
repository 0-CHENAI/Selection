/**
 * OpenAI-compatible GET /v1/models helper.
 * Used by ORDER (and any branded gateway) after the user pastes an API key.
 */

import {
  connectionModelIdsMatch,
  DEFAULT_CUSTOM_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MAX_TOKENS,
  inferModelSupportsImages,
  MAX_CUSTOM_CONTEXT_WINDOW,
  MAX_CUSTOM_MAX_TOKENS,
  MIN_CUSTOM_CONTEXT_WINDOW,
  MIN_CUSTOM_MAX_TOKENS,
  sanitizeCustomContextWindow,
  sanitizeCustomMaxTokens,
} from '../../../../../../packages/shared/src/config/model-image-support.ts'

export { inferModelSupportsImages }

export interface RemoteModel {
  id: string
  name: string
  /** Declared catalog capability only. Undefined = unknown (infer at display/send time). */
  supportsImages?: boolean
  /** Declared catalog context window in tokens. */
  contextWindow?: number
  /** Declared catalog max output tokens. */
  maxTokens?: number
}

export interface ModelLimitPreset {
  label: string
  value: number
}

export interface ModelLimitOption extends ModelLimitPreset {
  /** Non-preset provider/saved values remain visible but cannot be chosen anew. */
  readOnly: boolean
}

export const MODEL_CONTEXT_WINDOW_PRESETS: readonly ModelLimitPreset[] = [
  { label: '200K', value: 200 * 1_024 },
  { label: '256K', value: 256 * 1_024 },
  { label: '512K', value: 512 * 1_024 },
  { label: '1M', value: 1_024 * 1_024 },
  { label: '1.5M', value: 1_536 * 1_024 },
  { label: '2M', value: 2_048 * 1_024 },
]

export const MODEL_MAX_OUTPUT_PRESETS: readonly ModelLimitPreset[] = [
  { label: '64K', value: 64 * 1_024 },
  { label: '128K', value: 128 * 1_024 },
  { label: '256K', value: 256 * 1_024 },
]

/** Conservative presets used only for newly configured renderer entries. */
export const DEFAULT_MODEL_CONTEXT_WINDOW_PRESET = MODEL_CONTEXT_WINDOW_PRESETS[0]!.value
export const DEFAULT_MODEL_MAX_OUTPUT_PRESET = MODEL_MAX_OUTPUT_PRESETS[0]!.value

/**
 * Standard options stay selectable. A detected or previously stored custom
 * value is inserted as the selected, read-only option so it is never rounded
 * or relabelled as one of the presets.
 *
 * Output options use an exclusive upper bound: reserving no room at all for
 * input is invalid even when max output equals the nominal context window.
 */
export function buildModelLimitOptions(
  presets: readonly ModelLimitPreset[],
  currentValue: number,
  upperExclusive?: number,
): ModelLimitOption[] {
  const selectable = presets
    .filter((option) => upperExclusive === undefined || option.value < upperExclusive)
    .map((option) => ({ ...option, readOnly: false }))
  if (selectable.some((option) => option.value === currentValue)) return selectable

  const knownLabel = presets.find((option) => option.value === currentValue)?.label
  return [
    { label: knownLabel ?? String(currentValue), value: currentValue, readOnly: true },
    ...selectable,
  ]
}

export function isValidModelLimitCombination(maxTokens: number, contextWindow: number): boolean {
  return Number.isFinite(maxTokens)
    && Number.isFinite(contextWindow)
    && maxTokens > 0
    && maxTokens < contextWindow
}

/** Keep a valid value; otherwise choose the largest preset that leaves input room. */
export function resolveMaxTokensForContext(currentValue: number, contextWindow: number): number {
  if (isValidModelLimitCombination(currentValue, contextWindow)) return currentValue
  const fallback = MODEL_MAX_OUTPUT_PRESETS
    .filter((option) => option.value < contextWindow)
    .at(-1)
  return fallback?.value ?? Math.max(1, Math.floor(contextWindow) - 1)
}


export function findRemoteModel(models: readonly RemoteModel[], id: string): RemoteModel | undefined {
  return models.find((model) => connectionModelIdsMatch(model.id, id))
}

export function lookupRecordByModelId<T>(
  record: Record<string, T> | undefined,
  id: string,
): T | undefined {
  if (!record) return undefined
  if (Object.prototype.hasOwnProperty.call(record, id)) return record[id]
  const key = Object.keys(record).find((candidate) => connectionModelIdsMatch(candidate, id))
  return key === undefined ? undefined : record[key]
}

export function setHasModelId(ids: ReadonlySet<string>, id: string): boolean {
  if (ids.has(id)) return true
  for (const candidate of ids) {
    if (connectionModelIdsMatch(candidate, id)) return true
  }
  return false
}

/**
 * Auto-detect from /v1/models, but keep an explicit user/saved value.
 * A stored default (the visible fallback) does not hide a later catalog value.
 */
export function resolveCatalogOrOverrideLimit(opts: {
  edited: boolean
  override?: number
  catalog?: number
  fallback: number
  /** Previous product defaults that should not hide newer catalog metadata. */
  fallbackAliases?: readonly number[]
}): number {
  const { edited, override, catalog, fallback, fallbackAliases = [] } = opts
  if (edited && override !== undefined) return override
  if (catalog !== undefined) {
    const overrideIsDefault = override === fallback || fallbackAliases.includes(override ?? Number.NaN)
    if (override !== undefined && !overrideIsDefault && override !== catalog) return override
    return catalog
  }
  return override ?? fallback
}

export type ModelLimitSource = 'manual' | 'catalog' | 'default'

export function resolveModelLimitSource(opts: {
  edited: boolean
  override?: number
  catalog?: number
  displayed: number
  fallback: number
  fallbackAliases?: readonly number[]
}): ModelLimitSource {
  if (opts.edited) return 'manual'
  if (opts.catalog !== undefined && opts.displayed === opts.catalog) return 'catalog'
  const overrideIsDefault = opts.override === opts.fallback
    || (opts.fallbackAliases ?? []).includes(opts.override ?? Number.NaN)
  if (opts.override !== undefined && !overrideIsDefault) return 'manual'
  return 'default'
}

/** Clamp a draft/saved window so submit never replaces a too-small value with the default. */
export function persistCustomContextWindow(value: number): number {
  const sanitized = sanitizeCustomContextWindow(value)
  if (sanitized !== undefined) return sanitized
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CUSTOM_CONTEXT_WINDOW
  return Math.min(MAX_CUSTOM_CONTEXT_WINDOW, Math.max(MIN_CUSTOM_CONTEXT_WINDOW, Math.floor(value)))
}

/** Clamp a draft/saved max output to the context window and legal range. */
export function persistCustomMaxTokens(value: number, contextWindow: number): number {
  const sanitized = sanitizeCustomMaxTokens(value, contextWindow)
  if (sanitized !== undefined) return sanitized
  if (!Number.isFinite(value) || value <= 0) {
    return Math.min(DEFAULT_CUSTOM_MAX_TOKENS, contextWindow)
  }
  const clamped = Math.min(
    MAX_CUSTOM_MAX_TOKENS,
    Math.max(MIN_CUSTOM_MAX_TOKENS, Math.floor(value)),
    Math.floor(contextWindow),
  )
  return clamped >= MIN_CUSTOM_MAX_TOKENS
    ? clamped
    : Math.min(DEFAULT_CUSTOM_MAX_TOKENS, contextWindow)
}

export type ModelLimitsStatus = 'detecting' | 'detected' | 'unavailable' | 'defaults' | 'hint'

export function resolveModelLimitsStatus(opts: {
  loading: boolean
  catalogFilled: boolean
  fetchFailed: boolean
  hasKey: boolean
}): ModelLimitsStatus {
  if (opts.loading) return 'detecting'
  if (opts.catalogFilled) return 'detected'
  if (opts.fetchFailed && opts.hasKey) return 'unavailable'
  if (opts.hasKey) return 'defaults'
  return 'hint'
}

/** User override, then catalog declaration. Name is not used here. */
export function resolveRemoteModelSupportsImages(
  model: Pick<RemoteModel, 'id' | 'name' | 'supportsImages'>,
  override?: boolean,
): boolean {
  if (typeof override === 'boolean') return override
  if (typeof model.supportsImages === 'boolean') return model.supportsImages
  return false
}

/** Join base URL with /v1/models without doubling /v1. */
export function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`
}


import { parseOpenAiModelsPayload } from '@config/provider-model-payload'

export {
  parseOpenAiModelsPayload,
  readDeclaredContextWindow,
  readDeclaredMaxTokens,
  readDeclaredSupportsImages,
} from '@config/provider-model-payload'

export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<RemoteModel[]> {
  const url = modelsEndpoint(baseUrl)
  if (!url) throw new Error('missing_base_url')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: 'application/json',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`models_http_${response.status}`)
  }

  const json: unknown = await response.json()
  return parseOpenAiModelsPayload(json)
}

/** ASCII, fullwidth, and enumeration commas — zh placeholders use `，`. */
const MODEL_LIST_SEPARATOR = /[,，、]/

export function parseSelectedModels(value: string): string[] {
  return value
    .split(MODEL_LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** First selected id only. Never pass a joined list to connection tests. */
export function firstSelectedModelId(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  return parseSelectedModels(value)[0]
}

export function toggleSelectedModel(current: string, id: string): string {
  const selected = parseSelectedModels(current)
  const has = selected.some((item) => connectionModelIdsMatch(item, id))
  const next = has
    ? selected.filter((item) => !connectionModelIdsMatch(item, id))
    : [...selected, id]
  return next.join(', ')
}

/**
 * Provider catalogs drop retired IDs, but saved selections still need a row
 * the user can uncheck. Missing IDs are prepended and keep their stored form.
 */
export function mergeMissingSelectedModels(
  models: readonly RemoteModel[],
  selectedIds: readonly string[],
): RemoteModel[] {
  const missing: RemoteModel[] = []
  for (const id of selectedIds) {
    if (findRemoteModel(models, id) || findRemoteModel(missing, id)) continue
    missing.push({ id, name: id })
  }
  return missing.length === 0 ? [...models] : [...missing, ...models]
}
