/**
 * One-shot model catalog for a custom endpoint.
 *
 * The renderer asks the workspace server to perform the GET so the API key
 * never goes through a browser fetch (CORS) and is not written to logs.
 * OpenAI Compatible reads `{base}/models` (a base that omits `/v1` still
 * targets `/v1/models`). Anthropic Compatible reads `{base}/v1/models`,
 * without doubling `/v1`. Official api.anthropic.com uses `x-api-key` and
 * `anthropic-version`; every other host uses Bearer. If the Anthropic route
 * fails, the same host's OpenAI `/v1/models` is tried once.
 */

import { isOfficialAnthropicApiUrl } from './anthropic-api-host.ts'
import type { CustomEndpointApi } from './llm-connections.ts'
import { connectionModelIdsMatch } from './model-image-support.ts'
import {
  parseOpenAiModelsPayload,
  type ProviderListedModel,
} from './provider-model-payload.ts'

const ANTHROPIC_VERSION = '2023-06-01'
const MODEL_LIST_SEPARATOR = /[,，、]/

export type CustomModelListSource = 'openai' | 'anthropic' | 'openai-fallback'

export interface CustomModelListAttempt {
  url: string
  protocol: CustomEndpointApi
  source: CustomModelListSource
}

export interface FetchCustomEndpointModelsInput {
  baseUrl: string
  apiKey: string
  api: CustomEndpointApi
}

export type FetchCustomEndpointModelsResult =
  | { ok: true; models: ProviderListedModel[]; source: CustomModelListSource }
  | { ok: false; error: 'missing_input' | 'unavailable' }

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  body?: { cancel?: () => Promise<void> } | null
}>

function httpBase(baseUrl: string): URL | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.username = ''
  url.password = ''
  url.hash = ''
  return url
}

function modelsUrl(baseUrl: string): string {
  const url = httpBase(baseUrl)
  if (!url) return ''
  const path = url.pathname.replace(/\/+$/, '')
  const root = `${url.origin}${path}`
  if (/\/models$/i.test(path)) return `${root}${url.search}`
  if (/\/v1$/i.test(path)) return `${root}/models${url.search}`
  return `${root}/v1/models${url.search}`
}

/** OpenAI Compatible: `{base}/models` when base already ends in `/v1`. */
export function openaiCompatibleModelsUrl(baseUrl: string): string {
  return modelsUrl(baseUrl)
}

/** Anthropic Compatible: `{base}/v1/models`, including a base that already has `/v1`. */
export function anthropicCompatibleModelsUrl(baseUrl: string): string {
  return modelsUrl(baseUrl)
}

/** OpenAI-style catalog on the same host, ignoring any path prefix on the base. */
export function sameHostOpenAiModelsUrl(baseUrl: string): string {
  const url = httpBase(baseUrl)
  if (!url) return ''
  return `${url.origin}/v1/models`
}

function sameRequestUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    const path = (value: URL) => value.pathname.replace(/\/+$/, '') || '/'
    return a.origin === b.origin && path(a) === path(b) && a.search === b.search
  } catch {
    return left === right
  }
}

export function planCustomEndpointModelRequests(
  baseUrl: string,
  api: CustomEndpointApi,
): CustomModelListAttempt[] {
  if (api === 'openai-completions') {
    const url = openaiCompatibleModelsUrl(baseUrl)
    return url ? [{ url, protocol: 'openai-completions', source: 'openai' }] : []
  }
  if (api !== 'anthropic-messages') return []
  const primary = anthropicCompatibleModelsUrl(baseUrl)
  if (!primary) return []
  const attempts: CustomModelListAttempt[] = [
    { url: primary, protocol: 'anthropic-messages', source: 'anthropic' },
  ]
  const fallback = sameHostOpenAiModelsUrl(baseUrl)
  if (fallback && !sameRequestUrl(primary, fallback)) {
    attempts.push({
      url: fallback,
      protocol: 'openai-completions',
      source: 'openai-fallback',
    })
  }
  return attempts
}

/**
 * Headers for a model-list GET. Official Anthropic gets `x-api-key` only.
 * Third-party Anthropic gateways get Bearer and no `x-api-key`. OpenAI
 * Compatible, including the same-host fallback, gets Bearer only.
 */
export function modelListAuthHeaders(
  url: string,
  apiKey: string,
  protocol: CustomEndpointApi,
): Record<string, string> {
  const key = apiKey.trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (protocol === 'anthropic-messages' && isOfficialAnthropicApiUrl(url)) {
    headers['x-api-key'] = key
    headers['anthropic-version'] = ANTHROPIC_VERSION
    return headers
  }
  headers.Authorization = `Bearer ${key}`
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = ANTHROPIC_VERSION
  }
  return headers
}

export function sortListedModels(models: readonly ProviderListedModel[]): ProviderListedModel[] {
  return [...models].sort((a, b) => (
    a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true })
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  ))
}

export function dedupeListedModels(models: readonly ProviderListedModel[]): ProviderListedModel[] {
  const kept: ProviderListedModel[] = []
  for (const model of models) {
    if (kept.some((item) => connectionModelIdsMatch(item.id, model.id))) continue
    kept.push(model)
  }
  return kept
}

/**
 * Keep IDs the user already typed, in their order, and append fetched IDs
 * that are not already present. When the field is still the untouched
 * suggestion, replace it with the fetched list.
 */
export function mergeFetchedModelSelection(
  current: string,
  fetchedIds: readonly string[],
  preserveExisting: boolean,
): string {
  const existing = preserveExisting
    ? current.split(MODEL_LIST_SEPARATOR).map((entry) => entry.trim()).filter(Boolean)
    : []
  const next = [...existing]
  for (const id of fetchedIds) {
    const trimmed = id.trim()
    if (!trimmed) continue
    if (next.some((item) => connectionModelIdsMatch(item, trimmed))) continue
    next.push(trimmed)
  }
  return next.join(', ')
}

function linkAbort(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (!parent) return () => {}
  if (parent.aborted) {
    controller.abort()
    return () => {}
  }
  const onAbort = () => controller.abort()
  parent.addEventListener('abort', onAbort)
  return () => parent.removeEventListener('abort', onAbort)
}

export async function fetchCustomEndpointModels(
  input: FetchCustomEndpointModelsInput,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<FetchCustomEndpointModelsResult> {
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
  const api = input?.api
  if (!apiKey || (api !== 'openai-completions' && api !== 'anthropic-messages')) {
    return { ok: false, error: 'missing_input' }
  }
  const attempts = planCustomEndpointModelRequests(input.baseUrl ?? '', api)
  if (attempts.length === 0) return { ok: false, error: 'missing_input' }

  const fetchImpl = options?.fetchImpl ?? (fetch as unknown as FetchLike)
  const timeoutMs = options?.timeoutMs ?? 20_000

  for (const attempt of attempts) {
    if (options?.signal?.aborted) return { ok: false, error: 'unavailable' }
    const headers = modelListAuthHeaders(attempt.url, apiKey, attempt.protocol)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const unlink = linkAbort(options?.signal, controller)
    try {
      const response = await fetchImpl(attempt.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => undefined)
        continue
      }
      let json: unknown
      try {
        json = await response.json()
      } catch {
        continue
      }
      const models = sortListedModels(dedupeListedModels(parseOpenAiModelsPayload(json)))
      return { ok: true, models, source: attempt.source }
    } catch {
      if (options?.signal?.aborted) return { ok: false, error: 'unavailable' }
    } finally {
      clearTimeout(timer)
      unlink()
    }
  }

  return { ok: false, error: 'unavailable' }
}
