/**
 * OpenAI-compatible GET /v1/models helper.
 * Used by ORDER (and any branded gateway) after the user pastes an API key.
 */

export interface RemoteModel {
  id: string
  name: string
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
    models.push({ id, name })
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
