import {
  sanitizeCustomContextWindow,
  sanitizeCustomMaxTokens,
} from './model-image-support.ts'

export interface ProviderListedModel {
  id: string
  name: string
  /** Declared catalog capability only. Undefined = unknown. */
  supportsImages?: boolean
  /** Declared catalog context window in tokens. */
  contextWindow?: number
  /** Declared catalog max output tokens. */
  maxTokens?: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readBooleanFlag(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1) return true
    if (value === 'false' || value === 0) return false
  }
  return undefined
}

function modalityToken(entry: unknown): string {
  if (typeof entry === 'string') return entry.toLowerCase()
  const rec = asRecord(entry)
  if (rec && rec.type != null) return String(rec.type).toLowerCase()
  return String(entry).toLowerCase()
}

function modalitiesIncludeImage(value: unknown): boolean | undefined {
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (/image|vision|multimodal/.test(lower)) return true
    if (lower === 'text' || lower === 'text-only') return false
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  const items = value.map(modalityToken)
  if (items.some((entry) => /image|vision|visual/.test(entry))) return true
  if (items.length > 0 && items.every((entry) => entry === 'text' || entry === 'text-only')) return false
  return undefined
}

/** Read vision flags from common OpenAI-compatible / OpenRouter / LiteLLM payloads. */
export function readDeclaredSupportsImages(rec: Record<string, unknown>): boolean | undefined {
  const info = asRecord(rec.model_info) ?? asRecord(rec.info) ?? asRecord(rec.meta)
  const caps = asRecord(rec.capabilities) ?? asRecord(info?.capabilities)
  const arch = asRecord(rec.architecture)

  const flagged = readBooleanFlag(
    rec.supports_vision,
    rec.supportsVision,
    rec.vision,
    rec.supports_image_input,
    rec.supportsImageInput,
    rec.image_input,
    rec.supports_images,
    rec.supportsImages,
    rec.multimodal,
    caps?.vision,
    caps?.image,
    caps?.image_input,
    caps?.multimodal,
    info?.supports_vision,
    info?.supportsVision,
    info?.vision,
    info?.supports_image_input,
    info?.multimodal,
  )
  if (flagged !== undefined) return flagged

  if (arch) {
    const fromModality = modalitiesIncludeImage(arch.modality)
    if (fromModality !== undefined) return fromModality
    const fromArch = modalitiesIncludeImage(arch.input_modalities ?? arch.inputModalities)
    if (fromArch !== undefined) return fromArch
  }

  return modalitiesIncludeImage(
    rec.input_modalities
    ?? rec.inputModalities
    ?? rec.modalities
    ?? rec.supported_modalities
    ?? rec.supportedModalities
    ?? info?.input_modalities
    ?? caps?.input_modalities,
  )
}

function parseContextWindow(value: unknown): number | undefined {
  return sanitizeCustomContextWindow(value)
}

/** Read context length from common OpenAI-compatible / OpenRouter / LiteLLM payloads. */
export function readDeclaredContextWindow(rec: Record<string, unknown>): number | undefined {
  const info = asRecord(rec.model_info) ?? asRecord(rec.info) ?? asRecord(rec.meta)
  const caps = asRecord(rec.capabilities) ?? asRecord(info?.capabilities)
  const topProvider = asRecord(rec.top_provider)
  const limits = asRecord(rec.limits)

  const candidates = [
    rec.context_window,
    rec.contextWindow,
    rec.context_length,
    rec.contextLength,
    rec.max_model_len,
    rec.max_model_length,
    rec.max_context_tokens,
    rec.max_context_length,
    rec.max_input_tokens,
    rec.maxInputTokens,
    info?.max_input_tokens,
    info?.context_window,
    info?.context_length,
    info?.max_tokens,
    caps?.context_window,
    caps?.max_context_tokens,
    topProvider?.context_length,
    limits?.context_window,
    limits?.max_input_tokens,
  ]

  for (const value of candidates) {
    const parsed = parseContextWindow(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function parseMaxTokens(value: unknown): number | undefined {
  return sanitizeCustomMaxTokens(value)
}

/** Read max output tokens from common OpenAI-compatible / OpenRouter / LiteLLM payloads. */
export function readDeclaredMaxTokens(rec: Record<string, unknown>): number | undefined {
  const info = asRecord(rec.model_info) ?? asRecord(rec.info) ?? asRecord(rec.meta)
  const caps = asRecord(rec.capabilities) ?? asRecord(info?.capabilities)
  const topProvider = asRecord(rec.top_provider)
  const limits = asRecord(rec.limits)

  const candidates = [
    rec.max_output_tokens,
    rec.maxOutputTokens,
    rec.max_completion_tokens,
    rec.maxCompletionTokens,
    rec.max_output,
    rec.output_token_limit,
    info?.max_output_tokens,
    info?.max_completion_tokens,
    caps?.max_output_tokens,
    topProvider?.max_output_tokens,
    topProvider?.max_completion_tokens,
    limits?.max_output_tokens,
    limits?.max_completion_tokens,
  ]

  for (const value of candidates) {
    const parsed = parseMaxTokens(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}
export function parseOpenAiModelsPayload(json: unknown): ProviderListedModel[] {
  const rows = Array.isArray(json)
    ? json
    : (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : [])

  const seen = new Set<string>()
  const models: ProviderListedModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const id = String(rec.id ?? rec.name ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = String(rec.display_name ?? rec.displayName ?? rec.name ?? id).trim() || id
    const declared = readDeclaredSupportsImages(rec)
    const contextWindow = readDeclaredContextWindow(rec)
    // Preserve the catalog's declared output limit exactly. An invalid
    // context/output combination must be visible and fixed explicitly in the
    // form, not silently rewritten while parsing provider metadata.
    const maxTokens = sanitizeCustomMaxTokens(readDeclaredMaxTokens(rec))
    models.push({
      id,
      name,
      ...(declared !== undefined ? { supportsImages: declared } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    })
  }
  return models
}
