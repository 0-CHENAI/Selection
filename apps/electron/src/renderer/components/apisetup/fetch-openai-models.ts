/**
 * OpenAI-compatible GET /v1/models helper.
 * Used by ORDER (and any branded gateway) after the user pastes an API key.
 */

import { inferModelSupportsImages } from '../../../../../../packages/shared/src/config/model-image-support.ts'

export { inferModelSupportsImages }

export interface RemoteModel {
  id: string
  name: string
  /** Declared catalog capability only. Undefined = unknown (infer at display/send time). */
  supportsImages?: boolean
}

function modalitiesIncludeImage(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((entry) => String(entry).toLowerCase())
  if (items.some((entry) => entry === 'image' || entry === 'vision')) return true
  if (items.length > 0 && items.every((entry) => entry === 'text')) return false
  return undefined
}

/** Read vision flags from common OpenAI-compatible / OpenRouter payloads. */
export function readDeclaredSupportsImages(rec: Record<string, unknown>): boolean | undefined {
  if (typeof rec.supports_vision === 'boolean') return rec.supports_vision
  if (typeof rec.supportsVision === 'boolean') return rec.supportsVision
  if (typeof rec.vision === 'boolean') return rec.vision

  const caps = rec.capabilities
  if (caps && typeof caps === 'object') {
    const vision = (caps as { vision?: unknown }).vision
    if (typeof vision === 'boolean') return vision
  }

  const arch = rec.architecture
  if (arch && typeof arch === 'object') {
    const a = arch as Record<string, unknown>
    if (typeof a.modality === 'string') {
      if (/image|vision/i.test(a.modality)) return true
      if (a.modality.toLowerCase() === 'text') return false
    }
    const fromArch = modalitiesIncludeImage(a.input_modalities ?? a.inputModalities)
    if (fromArch !== undefined) return fromArch
  }

  return modalitiesIncludeImage(rec.input_modalities ?? rec.inputModalities ?? rec.input)
}

/** Join base URL with /v1/models without doubling /v1. */
export function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`
}

export function parseOpenAiModelsPayload(json: unknown): RemoteModel[] {
  const rows = Array.isArray(json)
    ? json
    : (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : [])

  const seen = new Set<string>()
  const models: RemoteModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const id = String(rec.id ?? rec.name ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = String(rec.display_name ?? rec.displayName ?? rec.name ?? id).trim() || id
    const declared = readDeclaredSupportsImages(rec)
    models.push({
      id,
      name,
      ...(declared !== undefined ? { supportsImages: declared } : {}),
    })
  }
  return models
}

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

export function parseSelectedModels(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

export function toggleSelectedModel(current: string, id: string): string {
  const selected = parseSelectedModels(current)
  const next = selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id]
  return next.join(', ')
}
