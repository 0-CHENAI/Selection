/**
 * Live Google AI Studio (Gemini API) model catalog & native provider wrapper.
 *
 * The Pi SDK ships a generated snapshot (`google.json`) that lags behind new
 * Gemini releases (e.g. Gemini 4 Carbon / Neon / Hydrogen) and still contains
 * deprecated 2.5 models that return 404 on newly created AI Studio API keys.
 *
 * This module provides:
 * - Live model discovery via GET /v1beta/models (with x-goog-api-key header)
 * - Fast API-key connectivity probing that does not depend on a hardcoded model
 * - Lazy native Pi provider wrapping (`withGoogleModels`) so newly discovered
 *   Gemini models stream through the official `@google/genai` adapter.
 *
 * Renderer-safe: only type-only imports from `@earendil-works/pi-ai`.
 */

import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import type { ModelDefinition } from './models.ts'
import type { CustomEndpointModelPayload } from './model-image-support.ts'
import type { ThinkingLevel } from '../agent/thinking-levels.ts'
import {
  modelThinkingCapability,
  thinkingFieldsFromUpstream,
  thinkingLevelMapForLevels,
} from '../agent/thinking-capabilities.ts'

export const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const GOOGLE_MODELS_URL = `${GOOGLE_API_BASE_URL}/models`

/**
 * Preferred active Google AI Studio models, ordered newest/flagship first.
 * Shared with `PI_PREFERRED_DEFAULTS.google` so default model selection and
 * utility/mini model selection land on active models instead of deprecated 2.5 IDs.
 */
export const GOOGLE_PREFERRED_MODELS: readonly string[] = [
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-lite-latest',
]

const MIN_CONTEXT_WINDOW = 1_024
const MAX_CONTEXT_WINDOW = 10_000_000
const DEFAULT_GOOGLE_CONTEXT_WINDOW = 1_048_576
const MIN_MAX_TOKENS = 256
const DEFAULT_GOOGLE_MAX_TOKENS = 65_536
const MAX_PAGINATION_PAGES = 5

/** Levels accepted by Pi SDK's `google-generative-ai` wire adapter (`resolveGoogleThinkingLevel`). */
const GOOGLE_SDK_SUPPORTED_LEVELS: ReadonlySet<ThinkingLevel> = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
])

export interface GoogleCatalogModel {
  id: string
  name: string
  description: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
}

export type GoogleCatalogFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseTokenLimit(value: unknown, min: number, max: number): number | undefined {
  const raw = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const tokens = Math.floor(raw)
  if (tokens < min || tokens > max) return undefined
  return tokens
}

function normalizeGoogleBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '')
  return trimmed || GOOGLE_API_BASE_URL
}

/**
 * Filter Google `/v1beta/models` entries down to text/multimodal chat models
 * usable in Selection's agent loop.
 */
export function isGoogleChatModelId(rawId: string): boolean {
  const id = rawId.trim().toLowerCase()
  if (!id) return false
  if (!id.startsWith('gemini-') && !id.startsWith('gemma-')) return false

  // Retired 1.0 / 1.5 / 2.0 models (return 404 on v1beta)
  if (
    id === 'gemini-pro'
    || id === 'gemini-pro-vision'
    || /^gemini-1(?:\.\d+)?(?:-|$)/.test(id)
    || /^gemini-2\.0(?:-|$)/.test(id)
  ) {
    return false
  }

  // Non-chat specialized endpoints (embeddings, TTS, image gen, live audio, transcription, decision classifiers)
  if (
    id.includes('embedding')
    || id.includes('nano-banana')
    || id.includes('native-audio')
    || /(?:^|-)transcribe(?:$|-)/.test(id)
    || /(?:^|-)tts(?:$|-)/.test(id)
    || /(?:^|-)image(?:$|-)/.test(id)
    || /(?:^|-)audio(?:$|-)/.test(id)
    || /(?:^|-)live(?:$|-)/.test(id)
    || id.startsWith('gemini-live-')
    || id.startsWith('gemini-decision-')
  ) {
    return false
  }

  return true
}

function modelFamilyTier(id: string): number {
  const lower = id.toLowerCase()
  const preferredIndex = GOOGLE_PREFERRED_MODELS.findIndex(
    (entry) => lower === entry || lower.startsWith(`${entry}-`),
  )
  if (preferredIndex >= 0) return preferredIndex

  const majorMatch = lower.match(/^gemini-(\d+)/)
  if (majorMatch) {
    const major = Number.parseInt(majorMatch[1]!, 10)
    if (major >= 4) return 100 - Math.min(major, 99)
    if (major === 3) return 200
    if (major === 2) return 500
  }
  if (lower.startsWith('gemini-')) return 300
  if (lower.startsWith('gemma-')) return 400
  return 600
}

export function sortGoogleCatalogModels<T extends { id: string }>(models: readonly T[]): T[] {
  return [...models].sort((a, b) => {
    const bareA = a.id.startsWith('pi/') ? a.id.slice(3) : a.id
    const bareB = b.id.startsWith('pi/') ? b.id.slice(3) : b.id
    const tierDiff = modelFamilyTier(bareA) - modelFamilyTier(bareB)
    if (tierDiff !== 0) return tierDiff
    return bareA.localeCompare(bareB, 'en', { sensitivity: 'base', numeric: true })
  })
}

export function parseGoogleModelsPayload(json: unknown): {
  models: GoogleCatalogModel[]
  nextPageToken?: string
} {
  const root = asRecord(json)
  const rows = Array.isArray(root?.models) ? root.models : []
  const nextPageToken = typeof root?.nextPageToken === 'string' && root.nextPageToken.trim()
    ? root.nextPageToken.trim()
    : undefined

  const seen = new Set<string>()
  const models: GoogleCatalogModel[] = []

  for (const row of rows) {
    const rec = asRecord(row)
    if (!rec) continue

    const rawName = String(rec.name ?? '').trim()
    const id = rawName.replace(/^models\//i, '').trim()
    if (!id || seen.has(id) || !isGoogleChatModelId(id)) continue

    const methods = Array.isArray(rec.supportedGenerationMethods)
      ? rec.supportedGenerationMethods.map((m) => String(m))
      : []
    if (methods.length > 0 && !methods.includes('generateContent')) continue

    seen.add(id)

    const contextWindow = parseTokenLimit(rec.inputTokenLimit, MIN_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW)
      ?? DEFAULT_GOOGLE_CONTEXT_WINDOW
    const parsedMaxTokens = parseTokenLimit(rec.outputTokenLimit, MIN_MAX_TOKENS, contextWindow)
    const maxTokens = Math.min(parsedMaxTokens ?? DEFAULT_GOOGLE_MAX_TOKENS, contextWindow)
    const displayName = typeof rec.displayName === 'string' && rec.displayName.trim()
      ? rec.displayName.trim()
      : id
    const description = typeof rec.description === 'string' && rec.description.trim()
      ? rec.description.trim()
      : 'google model via Selection Backend'
    const reasoning = typeof rec.thinking === 'boolean'
      ? rec.thinking
      : modelThinkingCapability({ id, provider: 'google' }).mode !== 'unsupported'

    models.push({
      id,
      name: displayName,
      description,
      contextWindow,
      maxTokens,
      reasoning,
    })
  }

  return { models, nextPageToken }
}

function googleShortName(name: string): string {
  if (name.length <= 24) return name
  const withoutBrand = name.replace(/^Gemini\s+/i, '').trim()
  if (withoutBrand && withoutBrand.length <= 24) return withoutBrand
  const lastPart = name.split(/[\s-]/).pop() ?? name
  return lastPart
}

export function googleCatalogToModelDefinitions(
  models: readonly GoogleCatalogModel[],
): ModelDefinition[] {
  return sortGoogleCatalogModels(models).map((model) => {
    const base = {
      id: `pi/${model.id}`,
      name: model.name,
      shortName: googleShortName(model.name),
      description: model.description || 'google model via Selection Backend',
      provider: 'pi' as const,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }

    if (model.reasoning === false) {
      return {
        ...base,
        supportsThinking: false,
        supportedThinkingLevels: [],
        thinkingMode: 'unsupported' as const,
      }
    }

    const thinking = thinkingFieldsFromUpstream({
      id: model.id,
      provider: 'google',
      reasoning: model.reasoning,
      api: 'google-generative-ai',
    })
    if (thinking.thinkingMode === 'levels') {
      const supportedThinkingLevels = thinking.supportedThinkingLevels.filter(
        (level) => GOOGLE_SDK_SUPPORTED_LEVELS.has(level),
      )
      if (!supportedThinkingLevels.some((level) => level !== 'off')) {
        return {
          ...base,
          supportsThinking: false,
          supportedThinkingLevels: [],
          thinkingMode: 'unsupported' as const,
        }
      }
      return {
        ...base,
        ...thinking,
        supportedThinkingLevels,
      }
    }
    return {
      ...base,
      ...thinking,
    }
  })
}

export async function fetchGoogleAiStudioCatalog(options: {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: GoogleCatalogFetch
}): Promise<GoogleCatalogModel[]> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) return []

  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 15_000
  const base = normalizeGoogleBaseUrl(options.baseUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const seen = new Set<string>()
    const collected: GoogleCatalogModel[] = []
    let pageToken: string | undefined

    for (let page = 0; page < MAX_PAGINATION_PAGES; page += 1) {
      const url = new URL(`${base}/models`)
      url.searchParams.set('pageSize', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`google_models_http_${response.status}`)
      }

      const parsed = parseGoogleModelsPayload(await response.json())
      for (const model of parsed.models) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        collected.push(model)
      }

      if (!parsed.nextPageToken) break
      pageToken = parsed.nextPageToken
    }

    return sortGoogleCatalogModels(collected)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Validate a Google AI Studio API key directly against GET /v1beta/models.
 * Avoids failing setup when a legacy default model (e.g. gemini-2.5-flash) is
 * deprecated or blocked on newly created keys.
 */
export async function testGoogleAiStudioAccess(
  apiKey: string,
  baseUrl?: string,
  timeoutMs = 15_000,
  fetchImpl?: GoogleCatalogFetch,
): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    return { success: false, error: 'API key is required' }
  }

  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init))
  const base = normalizeGoogleBaseUrl(baseUrl)
  const url = `${base}/models?pageSize=1`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await doFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'x-goog-api-key': trimmedKey,
      },
    })

    if (res.ok) {
      try {
        await res.json()
      } catch {
        // Ignore non-JSON body when status is already 2xx
      }
      return { success: true }
    }

    const text = await res.text().catch(() => '')
    const lower = text.toLowerCase()
    if (lower.includes('api_key_expired') || lower.includes('api key expired')) {
      return { success: false, error: 'API key has expired. Create a new key in Google AI Studio.' }
    }
    if (
      res.status === 401
      || lower.includes('api_key_invalid')
      || lower.includes('api key not valid')
    ) {
      return { success: false, error: 'Invalid API key' }
    }
    return { success: false, error: `${res.status} ${text}`.slice(0, 500) }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Connection test timed out' }
    }
    return { success: false, error: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

function buildGoogleThinkingLevelMap(
  id: string,
  entry: {
    supportedThinkingLevels?: readonly ThinkingLevel[]
    thinkingMode?: 'unsupported' | 'always-on' | 'levels'
  },
  fallbackMap: Model<Api>['thinkingLevelMap'],
): { reasoning: boolean; thinkingLevelMap?: Model<Api>['thinkingLevelMap'] } {
  if (entry.thinkingMode === 'unsupported') {
    return { reasoning: false }
  }
  const capability = modelThinkingCapability({
    id,
    provider: 'google',
    api: 'google-generative-ai',
    supportedThinkingLevels: entry.supportedThinkingLevels ? [...entry.supportedThinkingLevels] : undefined,
    thinkingMode: entry.thinkingMode,
  })
  if (capability.mode === 'unsupported') {
    return { reasoning: false }
  }
  if (capability.mode === 'always-on') {
    return {
      reasoning: true,
      thinkingLevelMap: thinkingLevelMapForLevels(['low']),
    }
  }
  const safeLevels = capability.levels.filter((level) => GOOGLE_SDK_SUPPORTED_LEVELS.has(level))
  const hasThinkingStop = safeLevels.some((level) => level !== 'off')
  if (!hasThinkingStop) {
    return fallbackMap
      ? { reasoning: true, thinkingLevelMap: fallbackMap }
      : { reasoning: false }
  }
  return {
    reasoning: true,
    thinkingLevelMap: thinkingLevelMapForLevels(safeLevels),
  }
}

/**
 * Wrap Pi's native `google` provider so newly discovered AI Studio models
 * (e.g. Gemini 4 Carbon / Neon / Hydrogen) stream through the official
 * `google-generative-ai` (`@google/genai`) adapter alongside bundled models.
 *
 * Reads `connectionModels` lazily so runtime config refreshes immediately make
 * newly fetched models resolvable without recreating the runtime.
 */
export function withGoogleModels(
  provider: Provider,
  connectionModels: () => readonly CustomEndpointModelPayload[] | undefined,
): Provider {
  const getModels = (): Model<Api>[] => {
    const builtin = provider.getModels()
    const models = new Map(builtin.map((model) => [model.id, model]))
    const transport = models.get('gemini-4-argon') ?? models.get('gemini-3.8-flash') ?? builtin[0]
    const configured = connectionModels()
    if (!configured?.length || !transport) return [...models.values()]

    const { thinkingLevelMap: _transportThinkingMap, ...transportBase } = transport

    for (const item of configured) {
      const entry = typeof item === 'string' ? { id: item } : item
      const id = entry.id.trim().replace(/^pi\//i, '')
      if (!id) continue

      const existing = models.get(id)
      if (existing) {
        const hasThinkingOverride = entry.thinkingMode !== undefined || entry.supportedThinkingLevels !== undefined
        const contextWindow = entry.contextWindow ?? existing.contextWindow
        const maxTokens = Math.min(entry.maxTokens ?? existing.maxTokens, contextWindow)
        const input = entry.supportsImages === undefined
          ? existing.input
          : entry.supportsImages
            ? (['text', 'image'] as Model<Api>['input'])
            : (['text'] as Model<Api>['input'])

        if (!hasThinkingOverride) {
          models.set(id, { ...existing, contextWindow, maxTokens, input })
        } else {
          const { thinkingLevelMap: _existingMap, ...existingBase } = existing
          const thinking = buildGoogleThinkingLevelMap(id, entry, existing.thinkingLevelMap)
          models.set(id, {
            ...existingBase,
            contextWindow,
            maxTokens,
            input,
            reasoning: thinking.reasoning,
            ...(thinking.reasoning && thinking.thinkingLevelMap ? { thinkingLevelMap: thinking.thinkingLevelMap } : {}),
          })
        }
        continue
      }

      const contextWindow = entry.contextWindow ?? transport.contextWindow
      const maxTokens = Math.min(entry.maxTokens ?? transport.maxTokens, contextWindow)
      const thinking = buildGoogleThinkingLevelMap(id, entry, transport.thinkingLevelMap)

      models.set(id, {
        ...transportBase,
        id,
        name: id,
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        input: entry.supportsImages === undefined
          ? transport.input
          : entry.supportsImages
            ? ['text', 'image']
            : ['text'],
        reasoning: thinking.reasoning,
        ...(thinking.reasoning && thinking.thinkingLevelMap ? { thinkingLevelMap: thinking.thinkingLevelMap } : {}),
      })
    }

    return [...models.values()]
  }

  return {
    ...provider,
    getModels,
    getAllModels: () => [
      ...getModels(),
      ...(provider.getAllModels?.() ?? []).filter((model) => model.type && model.type !== 'chat'),
    ],
  }
}
