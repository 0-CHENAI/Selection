/**
 * Thinking stops published by https://models.dev/api.json.
 *
 * `reasoning_options` is granular enough for discrete effort and for a
 * toggle. Budget-only models do not name stops, so they stay unresolved and
 * the static table (or a later probe) supplies the slider. A toggle listed
 * next to effort values is not treated as an Off stop: Kimi K3 publishes
 * both, while the official control is Low / High / Max.
 *
 * The parsed catalog is a compact list, not the ~6MB document. Callers
 * refresh it about once a day.
 */
import type { ThinkingLevel } from '../agent/thinking-levels.ts'
import { catalogThinkingModelId, bareThinkingModelId } from '../agent/thinking-capabilities-id.ts'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const MODELS_DEV_TTL_MS = 24 * 60 * 60 * 1000

export type ModelsDevThinkingMode = 'unsupported' | 'always-on' | 'levels'

export interface ModelsDevThinkingEntry {
  provider: string
  id: string
  mode: ModelsDevThinkingMode
  levels: ThinkingLevel[]
  requestLevel?: ThinkingLevel
}

export interface ModelsDevThinkingCache {
  fetchedAt: number
  entries: ModelsDevThinkingEntry[]
}

const EFFORT_ALIASES: Record<string, ThinkingLevel> = {
  none: 'off',
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  max: 'max',
  maximum: 'max',
}

const CANONICAL: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Selection auth ids that do not match the models.dev provider key.
 * The first alias is preferred.
 */
const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  'kimi-coding': ['kimi-code-plan-global', 'kimi-code-plan-cn'],
  'kimi-code': ['kimi-code-plan-global', 'kimi-code-plan-cn'],
  moonshot: ['moonshotai', 'moonshotai-cn'],
  'moonshotai-cn': ['moonshotai-cn', 'moonshotai'],
  'azure-openai-responses': ['azure', 'openai'],
  azure: ['azure', 'openai'],
  gemini: ['google'],
  'google-gemini': ['google'],
  zhipu: ['zai', 'zhipuai'],
  zhipuai: ['zai', 'zhipuai'],
  glm: ['zai'],
  qwen: ['alibaba', 'alibaba-cn'],
  dashscope: ['alibaba', 'alibaba-cn'],
  'alibaba-cn': ['alibaba-cn', 'alibaba'],
}

interface IndexedCapability {
  mode: ModelsDevThinkingMode
  levels: ThinkingLevel[]
  requestLevel?: ThinkingLevel
}

const byProvider = new Map<string, IndexedCapability>()
const byBare = new Map<string, IndexedCapability>()
const listeners = new Set<() => void>()
let version = 0
let installedFetchedAt = 0

function asLevel(value: string): ThinkingLevel | undefined {
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return EFFORT_ALIASES[key]
}

function ordered(levels: Iterable<ThinkingLevel>): ThinkingLevel[] {
  const selected = new Set(levels)
  return CANONICAL.filter(level => selected.has(level))
}

function signature(entry: IndexedCapability): string {
  return `${entry.mode}:${entry.levels.join(',')}:${entry.requestLevel ?? ''}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Kimi Code lists a toggle beside low/high/max, but the official control cannot
 * turn thinking off. Other providers' toggles do mean Off is a real stop.
 */
function toggleMeansOff(provider: string, id: string): boolean {
  const bare = bareThinkingModelId(id)
  if (/^k3($|[-.])|^kimi-k3($|[-.])|^kimi-for-coding$|^k3-256k$/.test(bare)) return false
  if (provider.startsWith('kimi-code') && /k3|kimi-for-coding/.test(bare) && !bare.includes('highspeed')) return false
  return true
}

export function capabilityFromReasoningOptions(
  reasoning: unknown,
  options: unknown,
  provider = '',
  id = '',
): IndexedCapability | undefined {
  const list = Array.isArray(options) ? options : []
  const effortValues: ThinkingLevel[] = []
  let toggle = false
  let budget = false
  for (const option of list) {
    const rec = asRecord(option)
    if (!rec) continue
    const type = String(rec.type ?? '')
    if (type === 'effort') {
      const values = Array.isArray(rec.values) ? rec.values : []
      for (const value of values) {
        const level = asLevel(String(value))
        if (level) effortValues.push(level)
      }
    } else if (type === 'toggle') {
      toggle = true
    } else if (type === 'budget_tokens' || type === 'budget') {
      budget = true
    }
  }
  if (effortValues.length > 0) {
    const levels = [...effortValues]
    if (toggle && toggleMeansOff(provider, id) && !levels.includes('off')) levels.push('off')
    return { mode: 'levels', levels: ordered(levels) }
  }
  // Budget without named efforts is not a slider. Toggle-only is on/off.
  if (budget) return undefined
  if (toggle) return { mode: 'levels', levels: ['off', 'high'] }
  if (reasoning === true) return { mode: 'always-on', levels: [], requestLevel: 'low' }
  if (reasoning === false) return { mode: 'unsupported', levels: [] }
  return undefined
}

export function parseModelsDevCatalog(json: unknown): ModelsDevThinkingEntry[] {
  const root = asRecord(json)
  if (!root) return []
  const entries: ModelsDevThinkingEntry[] = []
  for (const [provider, rawProvider] of Object.entries(root)) {
    const providerRec = asRecord(rawProvider)
    const models = asRecord(providerRec?.models)
    if (!models) continue
    for (const [id, rawModel] of Object.entries(models)) {
      const model = asRecord(rawModel)
      if (!model) continue
      const modelId = String(model.id ?? id).trim().toLowerCase()
      const capability = capabilityFromReasoningOptions(model.reasoning, model.reasoning_options, provider.toLowerCase(), modelId)
      if (!capability) continue
      entries.push({
        provider: provider.toLowerCase(),
        id: modelId,
        mode: capability.mode,
        levels: capability.levels,
        ...(capability.requestLevel ? { requestLevel: capability.requestLevel } : {}),
      })
    }
  }
  return entries
}

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

export function installModelsDevThinkingIndex(entries: readonly ModelsDevThinkingEntry[], fetchedAt = Date.now()): void {
  byProvider.clear()
  byBare.clear()
  const bareGroups = new Map<string, { signature: string; capability: IndexedCapability }>()
  for (const entry of entries) {
    const capability: IndexedCapability = {
      mode: entry.mode,
      levels: ordered(entry.levels),
      ...(entry.requestLevel ? { requestLevel: entry.requestLevel } : {}),
    }
    const provider = entry.provider.trim().toLowerCase()
    const id = entry.id.trim().toLowerCase()
    if (!provider || !id) continue
    byProvider.set(`${provider}:${id}`, capability)
    const bare = bareThinkingModelId(id)
    if (bare && bare !== id) byProvider.set(`${provider}:${bare}`, capability)
    const bareKey = bare || id
    const sig = signature(capability)
    const existing = bareGroups.get(bareKey)
    if (!existing) bareGroups.set(bareKey, { signature: sig, capability })
    else if (existing.signature !== sig) bareGroups.set(bareKey, { signature: '', capability })
  }
  for (const [bare, group] of bareGroups) {
    if (group.signature) byBare.set(bare, group.capability)
  }
  installedFetchedAt = fetchedAt
  notify()
}

export function clearModelsDevThinkingIndex(): void {
  byProvider.clear()
  byBare.clear()
  installedFetchedAt = 0
  notify()
}

export function modelsDevThinkingVersion(): number {
  return version
}

export function subscribeModelsDevThinking(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function lookupModelsDevThinking(
  provider: string | undefined,
  modelId: string,
): IndexedCapability | undefined {
  const catalogId = catalogThinkingModelId(modelId)
  const bare = bareThinkingModelId(modelId)
  const auth = provider?.trim().toLowerCase()
  if (auth && auth !== 'pi') {
    const aliases = PROVIDER_ALIASES[auth] ?? [auth]
    for (const alias of aliases) {
      const full = byProvider.get(`${alias}:${catalogId}`) ?? (bare ? byProvider.get(`${alias}:${bare}`) : undefined)
      if (full) return full
    }
  }
  return bare ? byBare.get(bare) : undefined
}

export interface ModelsDevStorage {
  read(): string | null
  write(value: string): void
}

export function serializeModelsDevCache(cache: ModelsDevThinkingCache): string {
  return JSON.stringify(cache)
}

export function readModelsDevCache(raw: string): ModelsDevThinkingCache | undefined {
  try {
    const parsed = JSON.parse(raw) as ModelsDevThinkingCache
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.entries)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

let inflight: Promise<void> | null = null

/**
 * Install a fresh compact cache, fetching models.dev when the saved copy is
 * older than a day. Failures keep the previous index.
 */
export function ensureModelsDevThinkingIndex(options: {
  storage?: ModelsDevStorage
  fetchImpl?: typeof fetch
  now?: number
  ttlMs?: number
} = {}): Promise<void> {
  if (inflight) return inflight
  inflight = refreshModelsDevThinkingIndex(options).finally(() => {
    inflight = null
  })
  return inflight
}

async function refreshModelsDevThinkingIndex(options: {
  storage?: ModelsDevStorage
  fetchImpl?: typeof fetch
  now?: number
  ttlMs?: number
}): Promise<void> {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? MODELS_DEV_TTL_MS
  const cached = options.storage ? readModelsDevCache(options.storage.read() ?? '') : undefined
  if (cached && now - cached.fetchedAt < ttlMs && cached.entries.length > 0) {
    if (cached.fetchedAt !== installedFetchedAt) installModelsDevThinkingIndex(cached.entries, cached.fetchedAt)
    return
  }
  try {
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(MODELS_DEV_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`models_dev_http_${response.status}`)
    const entries = parseModelsDevCatalog(await response.json())
    if (entries.length === 0) throw new Error('models_dev_empty')
    const cache = { fetchedAt: now, entries }
    installModelsDevThinkingIndex(entries, now)
    options.storage?.write(serializeModelsDevCache(cache))
  } catch {
    if (cached?.entries.length) installModelsDevThinkingIndex(cached.entries, cached.fetchedAt)
  }
}
