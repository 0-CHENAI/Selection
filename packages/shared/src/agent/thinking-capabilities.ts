/**
 * Per-model thinking stops.
 *
 * Resolution order, first hit wins:
 * 1. A runtime probe learned from a provider error (layer ③). This overrides a
 *    wrong catalog, otherwise a rejection could not correct the slider.
 * 2. An explicit user choice (`thinkingSource: 'explicit'`), including an
 *    empty list that means thinking is off.
 * 3. Stops a provider `/models` payload actually named (layer ①): Copilot
 *    `supportedReasoningEfforts`, OpenRouter `reasoning.supported_efforts`.
 * 4. A narrower stored list that is not a stale superset of the catalog.
 * 5. models.dev `reasoning_options` when that catalog is loaded (layer ②).
 * 6. A complete Pi `thinkingLevelMap` (every missing stop is an explicit null).
 *    Sparse maps are ignored — they used to fill in off/minimal/low/medium/high.
 * 7. The static table in this file, with official doc links (layer ④).
 * 8. A boolean reasoning flag becomes Off/High. Unknown models never receive
 *    every stop.
 *
 * Pi still translates a stop into the provider parameter. We only hand it a
 * stop the model accepts.
 */
import {
  THINKING_LEVEL_IDS,
  THINKING_LEVELS,
  type ThinkingLevel,
  type ThinkingLevelDefinition,
} from './thinking-levels.ts'
import { bareThinkingModelId } from './thinking-capabilities-id.ts'
import { parseUnsupportedThinkingEffort } from './thinking-effort-error.ts'
import {
  lookupThinkingProbe,
  rememberThinkingProbe,
  subscribeThinkingProbes,
  thinkingProbeKeys,
  thinkingProbeVersion,
  type ThinkingProbeRecord,
} from './thinking-probe.ts'
import {
  lookupModelsDevThinking,
  modelsDevThinkingVersion,
  subscribeModelsDevThinking,
} from '../config/models-dev-thinking.ts'
import { lookupOpenRouterEfforts } from '../config/openrouter-effort-cache.ts'

export { bareThinkingModelId } from './thinking-capabilities-id.ts'

export type ThinkingMode = 'unsupported' | 'always-on' | 'levels'

export type ThinkingCapabilitySource =
  | 'explicit'
  | 'probe'
  | 'provider-api'
  | 'models-dev'
  | 'sdk-map'
  | 'static'
  | 'conservative'

export interface ThinkingCapability {
  mode: ThinkingMode
  /** Slider stops, in canonical order. Empty unless `mode` is `levels`. */
  levels: ThinkingLevel[]
  /** Two stops, and the first is off: the control is a switch, not a scale. */
  binary?: boolean
  /** Effort to send when the model thinks and the user cannot pick a stop. */
  requestLevel?: ThinkingLevel
  /** Which layer produced this capability. */
  source?: ThinkingCapabilitySource
}

export interface ThinkingModelRef {
  id?: string
  /** Auth provider id (`kimi-coding`, `openai`), not the ModelDefinition provider `pi`. */
  provider?: string
  reasoning?: boolean
  supportsThinking?: boolean
  supportedThinkingLevels?: ThinkingLevel[]
  thinkingMode?: ThinkingMode
  thinkingSource?: ThinkingCapabilitySource
  thinkingLevelMap?: Record<string, string | null> | null
  api?: string
  supportsReasoningEffort?: boolean
  thinkingFormat?: string
  supportedReasoningEfforts?: string[]
  /** Provider says thinking cannot be disabled. Omitting `none` then hides Off. */
  reasoningMandatory?: boolean
}

export interface ThinkingCapabilityOptions {
  /** Used while recording a probe, so the lookup does not return the probe being replaced. */
  ignoreProbe?: boolean
}

const UPSTREAM_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const EFFORT_ALIASES: Record<string, ThinkingLevel> = {
  none: 'off',
  off: 'off',
  minimal: 'minimal',
  min: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  'extra-high': 'xhigh',
  extra_high: 'xhigh',
  max: 'max',
  maximum: 'max',
}

function asLevel(value: string): ThinkingLevel | undefined {
  return (THINKING_LEVEL_IDS as readonly string[]).includes(value) ? value as ThinkingLevel : undefined
}

function ordered(levels: Iterable<ThinkingLevel>): ThinkingLevel[] {
  const selected = new Set(levels)
  return THINKING_LEVEL_IDS.filter(level => selected.has(level))
}

function levelsCapability(levels: ThinkingLevel[], source?: ThinkingCapabilitySource): ThinkingCapability {
  const unique = ordered(levels)
  return {
    mode: 'levels',
    levels: unique,
    binary: unique.length === 2 && unique[0] === 'off',
    ...(source ? { source } : {}),
  }
}

function unsupported(source?: ThinkingCapabilitySource): ThinkingCapability {
  return { mode: 'unsupported', levels: [], ...(source ? { source } : {}) }
}

function alwaysOn(source?: ThinkingCapabilitySource): ThinkingCapability {
  return { mode: 'always-on', levels: [], requestLevel: 'low', ...(source ? { source } : {}) }
}

function withSource(capability: ThinkingCapability, source: ThinkingCapabilitySource): ThinkingCapability {
  return { ...capability, source }
}

/**
 * Same acceptance rule as Pi's `getSupportedThinkingLevels`: missing stops
 * through `high` use the provider default, while `xhigh` and `max` are opt-in.
 * Stops that share one wire value collapse to the canonical name (`low` wins
 * over Anthropic's default `minimal` → `low`).
 *
 * Callers that resolve a model skip maps that contain no explicit `null`.
 * Those sparse maps would otherwise invent off/minimal/low/medium/high.
 */
export function levelsFromThinkingLevelMap(
  reasoning: boolean,
  map: Record<string, string | null> | null | undefined,
  api?: string,
): ThinkingLevel[] {
  if (!reasoning) return []
  const visible = UPSTREAM_LEVELS.filter(level => {
    const mapped = map?.[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
  const wireOf = (level: typeof UPSTREAM_LEVELS[number]): string => {
    const mapped = map?.[level]
    if (typeof mapped === 'string' && mapped.trim()) return mapped.trim().toLowerCase()
    if (api === 'anthropic-messages' && level === 'minimal') return 'low'
    return level
  }
  const wires = visible.map(level => ({ level, wire: wireOf(level) }))
  const kept = new Set<ThinkingLevel>()
  const seen = new Set<string>()
  for (const entry of wires) {
    if (seen.has(entry.wire)) continue
    const canonical = wires.find(other => other.level === entry.wire)?.level ?? asLevel(entry.wire)
    const chosen = canonical && visible.includes(canonical as typeof entry.level) ? canonical : entry.level
    const chosenLevel = asLevel(chosen) ?? asLevel(entry.level)
    if (!chosenLevel) continue
    seen.add(entry.wire)
    kept.add(chosenLevel)
  }
  return ordered(kept)
}

function booleanThinking(model: ThinkingModelRef): ThinkingCapability | undefined {
  const format = model.thinkingFormat
  const toggle = model.supportsReasoningEffort === false
    && (format === 'deepseek' || format === 'together' || format === 'string-thinking' || format === 'qwen')
  if (!toggle) return undefined
  if (model.reasoning === false || model.supportsThinking === false) return unsupported()
  if (model.thinkingLevelMap?.off === null) return alwaysOn()
  return levelsCapability(['off', 'high'])
}

function fromEfforts(efforts: string[], mandatory?: boolean): ThinkingCapability {
  const found = new Set<ThinkingLevel>()
  let includesOff = false
  for (const raw of efforts) {
    const key = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
    const level = EFFORT_ALIASES[key] ?? EFFORT_ALIASES[key.replace(/-/g, '_')]
    if (!level) continue
    if (level === 'off') includesOff = true
    else found.add(level)
  }
  if (found.size === 0) return unsupported()
  const withOff = includesOff || mandatory !== true
  return levelsCapability(withOff ? ['off', ...found] : [...found])
}

function explicitLevels(levels: ThinkingLevel[]): ThinkingCapability {
  const valid = ordered(levels.filter(level => asLevel(level)))
  if (valid.length === 0) return unsupported()
  return levelsCapability(valid)
}

function sameLevels(stored: ThinkingLevel[], catalog: ThinkingCapability): boolean {
  if (catalog.mode !== 'levels') return false
  const valid = ordered(stored.filter(level => asLevel(level)))
  return valid.length === catalog.levels.length && catalog.levels.every(level => valid.includes(level))
}

/** A stale full slider is a strict superset of the official stops. */
function storedIsWider(stored: ThinkingLevel[], catalog: ThinkingCapability): boolean {
  const valid = ordered(stored.filter(level => asLevel(level)))
  if (catalog.mode !== 'levels') return valid.length > 0
  if (valid.length <= catalog.levels.length) return false
  return catalog.levels.every(level => valid.includes(level))
}

/**
 * Capability table used when no provider payload, models.dev entry, or
 * complete SDK map names the stops.
 *
 * Docs:
 * - Kimi effort: https://platform.kimi.ai/docs/guide/use-reasoning-effort
 *   and https://www.kimi.com/code/docs/en/kimi-code/models
 * - OpenAI: https://developers.openai.com/api/docs/guides/latest-model
 * - Gemini thinking levels: https://ai.google.dev/gemini-api/docs/thinking
 * - models.dev (preferred over this table once cached): https://models.dev/api.json
 */
export function fallbackThinkingCapability(modelId: string): ThinkingCapability | undefined {
  const id = bareThinkingModelId(modelId)
  if (!id) return undefined

  if (/^(gpt-3\.5|gpt-4($|[.-])|gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o)/.test(id)) return unsupported('static')

  // Adaptive effort, thinking stays on. https://models.dev anthropic claude-opus-4-8
  if (/claude-(fable|mythos)/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max'], 'static')
  if (/claude-(opus|sonnet|haiku)-5-5/.test(id) || /claude-(opus|haiku|sonnet)-5($|[^0-9])/.test(id)) {
    return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max'], 'static')
  }
  if (/claude-(opus-4-8|opus-4-7|sonnet-5)($|[^0-9])/.test(id)) {
    return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max'], 'static')
  }
  if (/claude-(opus-4-6|sonnet-4-6)/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'max'], 'static')
  if (/claude-(haiku-4|sonnet-4-5|opus-4-5|opus-4-1|opus-4$)/.test(id)) {
    return levelsCapability(['off', 'low', 'medium', 'high'], 'static')
  }
  if (id.startsWith('claude-')) return levelsCapability(['off', 'low', 'medium', 'high'], 'static')

  if (/^gpt-5-pro$/.test(id)) return levelsCapability(['high'], 'static')
  if (/^gpt-5$|^gpt-5-(mini|nano)$/.test(id)) return levelsCapability(['minimal', 'low', 'medium', 'high'], 'static')
  if (/^gpt-5\.1($|[^0-9])/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high'], 'static')
  if (/^gpt-5\.2-chat/.test(id)) return levelsCapability(['medium'], 'static')
  if (/gpt-5\.(2|4|5)-pro/.test(id)) return levelsCapability(['medium', 'high', 'xhigh'], 'static')
  if (/^gpt-5\.(2|3|4|5)/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'xhigh'], 'static')
  if (/^gpt-6-astra|^gpt-6\.1/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max'], 'static')
  if (/^gpt-5\.6|^gpt-6/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'static')
  if (/^o[134]($|[-.])/.test(id)) return levelsCapability(['low', 'medium', 'high'], 'static')

  // https://ai.google.dev/gemini-api/docs/thinking — 2.5 names low/medium/high.
  // Flash-Lite defaults off, so Off stays selectable. Flash and Pro start on.
  if (/gemini-2\.5-flash-lite/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high'], 'static')
  if (/gemini-2\.5/.test(id)) return levelsCapability(['low', 'medium', 'high'], 'static')
  if (/gemma-?4/.test(id)) return levelsCapability(['minimal', 'high'], 'static')
  if (/gemini-3(\.1)?-(flash|flash-lite|flash-preview|flash-lite-preview)|gemini-3\.(5|6)-flash|gemini-flash/.test(id)) {
    return levelsCapability(['minimal', 'low', 'medium', 'high'], 'static')
  }
  if (/gemini-3(\.1)?-pro|gemini-3\.(7|8)/.test(id)) return levelsCapability(['low', 'medium', 'high'], 'static')
  if (id.startsWith('gemini-') || id.startsWith('gemma-')) return levelsCapability(['off', 'high'], 'static')

  if (/deepseek-(r1|reasoner)/.test(id)) return alwaysOn('static')
  if (/deepseek-(v4-pro|chat-reasoner)/.test(id)) return levelsCapability(['off', 'high', 'max'], 'static')
  if (/deepseek-(v4-flash|flash)/.test(id)) return levelsCapability(['off', 'low', 'high', 'max'], 'static')
  if (id.startsWith('deepseek-')) return levelsCapability(['off', 'high', 'max'], 'static')

  // HighSpeed and K2.7 think whenever they run. K3 / K2.8 Code accept low, high, max.
  if (/kimi-k2\.7|kimi-k2-7|kimi-for-coding-highspeed|for-coding-highspeed|k2\.7-code-highspeed/.test(id)) {
    return alwaysOn('static')
  }
  if (/kimi-k2\.6/.test(id)) return levelsCapability(['off', 'high'], 'static')
  if (/kimi-k3|^k3($|[-.])|kimi-for-coding$|k3-256k/.test(id)) return levelsCapability(['low', 'high', 'max'], 'static')
  if (/kimi/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high'], 'static')

  if (/^grok-4\.3/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high'], 'static')
  if (/^grok-4\.(6|7)/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh'], 'static')
  if (/^grok-4/.test(id) || id.startsWith('grok-')) return levelsCapability(['low', 'medium', 'high'], 'static')

  if (/glm-5\.2/.test(id)) return levelsCapability(['off', 'high', 'max'], 'static')
  if (/glm-5\.3/.test(id)) return levelsCapability(['low', 'high', 'max'], 'static')
  if (/^glm-|^minimax-m/.test(id)) return levelsCapability(['off', 'high'], 'static')

  return undefined
}

function mapHasNull(map: Record<string, string | null> | null | undefined): boolean {
  return !!map && Object.values(map).some(value => value === null)
}

function mapHasWire(map: Record<string, string | null> | null | undefined): boolean {
  return !!map && Object.values(map).some(value => typeof value === 'string' && value.trim().length > 0)
}

/** Every stop is either a wire value or an explicit null. Missing keys are not a complete map. */
function mapIsComplete(map: Record<string, string | null> | null | undefined): boolean {
  return !!map && UPSTREAM_LEVELS.every(level => map[level] === null || typeof map[level] === 'string')
}

function fromSdkMap(model: ThinkingModelRef): ThinkingCapability | undefined {
  const toggle = booleanThinking(model)
  const map = model.thinkingLevelMap
  const usable = mapHasNull(map) || mapIsComplete(map)
  if (usable && !mapHasWire(map)) {
    const reasoning = model.reasoning !== false && model.supportsThinking !== false
    return withSource(reasoning ? alwaysOn() : unsupported(), 'sdk-map')
  }
  if (usable && mapHasWire(map)) {
    const reasoning = model.reasoning !== false && model.supportsThinking !== false
    const levels = levelsFromThinkingLevelMap(reasoning, map, model.api)
    if (!reasoning || levels.length === 0) return unsupported('sdk-map')
    return levelsCapability(levels, 'sdk-map')
  }
  if (toggle) return withSource(toggle, 'sdk-map')
  return undefined
}

function resolveCatalog(model: ThinkingModelRef): ThinkingCapability | undefined {
  if (model.id) {
    const fromDev = lookupModelsDevThinking(model.provider, model.id)
    if (fromDev) {
      if (fromDev.mode === 'always-on') return alwaysOn('models-dev')
      if (fromDev.mode === 'unsupported') return unsupported('models-dev')
      return levelsCapability(fromDev.levels, 'models-dev')
    }
  }
  const sdk = fromSdkMap(model)
  if (sdk) return sdk
  if (model.id) return fallbackThinkingCapability(model.id)
  return undefined
}

function fromProbe(record: ThinkingProbeRecord): ThinkingCapability {
  if (record.mode === 'always-on') return alwaysOn('probe')
  if (record.mode === 'unsupported') return unsupported('probe')
  const levels = ordered(record.levels.filter((level): level is ThinkingLevel => !!asLevel(level)))
  if (levels.length === 0) return unsupported('probe')
  return levelsCapability(levels, 'probe')
}

function explicitCapability(model: ThinkingModelRef, source: ThinkingCapabilitySource): ThinkingCapability | undefined {
  if (model.thinkingMode === 'always-on') return alwaysOn(source)
  if (model.thinkingMode === 'unsupported') return unsupported(source)
  if (model.supportedThinkingLevels !== undefined) return withSource(explicitLevels(model.supportedThinkingLevels), source)
  return undefined
}

export function modelThinkingCapability(
  model?: ThinkingModelRef,
  options?: ThinkingCapabilityOptions,
): ThinkingCapability {
  if (!model) return unsupported('conservative')

  if (!options?.ignoreProbe && model.id) {
    const probe = lookupThinkingProbe(model.provider, model.id)
    if (probe) return fromProbe(probe)
  }

  if (model.thinkingSource === 'explicit') {
    return explicitCapability(model, 'explicit') ?? unsupported('explicit')
  }

  if (model.thinkingMode === 'always-on') return alwaysOn(model.thinkingSource)
  if (model.thinkingMode === 'unsupported') return unsupported(model.thinkingSource)
  if (model.supportedThinkingLevels?.length === 0) return unsupported(model.thinkingSource)

  if (model.thinkingSource === 'provider-api' && model.supportedThinkingLevels && model.supportedThinkingLevels.length > 0) {
    return levelsCapability(model.supportedThinkingLevels, 'provider-api')
  }
  if (model.supportedReasoningEfforts && model.supportedReasoningEfforts.length > 0) {
    return withSource(fromEfforts(model.supportedReasoningEfforts, model.reasoningMandatory), 'provider-api')
  }
  if (model.provider === 'openrouter' && model.id) {
    const cached = lookupOpenRouterEfforts(model.id)
    if (cached) return withSource(fromEfforts(cached.efforts, cached.mandatory), 'provider-api')
  }

  const catalog = resolveCatalog(model)
  const stored = model.supportedThinkingLevels
  if (stored && stored.length > 0 && catalog) {
    if (sameLevels(stored, catalog)) return catalog
    if (!storedIsWider(stored, catalog)) return withSource(explicitLevels(stored), 'explicit')
  } else if (catalog) {
    return catalog
  }

  if (stored && stored.length > 0 && !catalog) return withSource(explicitLevels(stored), 'explicit')
  if (catalog) return catalog

  if (model.reasoning === true || model.supportsThinking === true) return levelsCapability(['off', 'high'], 'conservative')
  return unsupported('conservative')
}

/**
 * Learn from a provider error and hide the rejected stop. Returns false when
 * the message is not an effort rejection.
 */
export function applyThinkingProbe(model: ThinkingModelRef, record: ThinkingProbeRecord): void {
  if (!model.id) return
  const levels = ordered(record.levels.filter((level): level is ThinkingLevel => !!asLevel(level)))
  rememberThinkingProbe(thinkingProbeKeys(model.provider, model.id), {
    mode: record.mode,
    levels: record.mode === 'levels' ? levels : [],
    ...(record.binary ? { binary: true } : {}),
    ...(record.requestLevel ? { requestLevel: record.requestLevel } : {}),
  })
}

export function noteThinkingEffortError(model: ThinkingModelRef, message: string): boolean {
  if (!model.id) return false
  const parsed = parseUnsupportedThinkingEffort(message)
  if (!parsed) return false
  const current = modelThinkingCapability(model, { ignoreProbe: true })
  let next: ThinkingCapability
  if (parsed.allowed?.length) {
    next = levelsCapability(parsed.allowed, 'probe')
  } else if (parsed.rejected && current.mode === 'levels' && current.levels.includes(parsed.rejected)) {
    const levels = current.levels.filter(level => level !== parsed.rejected)
    next = levels.length > 0 ? levelsCapability(levels, 'probe') : unsupported('probe')
  } else {
    return false
  }
  rememberThinkingProbe(thinkingProbeKeys(model.provider, model.id), {
    mode: next.mode,
    levels: next.levels,
    ...(next.binary ? { binary: true } : {}),
    ...(next.requestLevel ? { requestLevel: next.requestLevel } : {}),
  })
  return true
}

export function subscribeThinkingCatalog(listener: () => void): () => void {
  const unsubProbe = subscribeThinkingProbes(listener)
  const unsubDev = subscribeModelsDevThinking(listener)
  return () => {
    unsubProbe()
    unsubDev()
  }
}

export function getThinkingCatalogVersion(): number {
  return thinkingProbeVersion() + modelsDevThinkingVersion()
}

export function modelThinkingLevels(model?: ThinkingModelRef): ThinkingLevelDefinition[] {
  const capability = modelThinkingCapability(model)
  if (capability.mode !== 'levels') return []
  return THINKING_LEVELS.filter(level => capability.levels.includes(level.id))
}

/**
 * Move `requested` onto a legal stop. Equal distance keeps the lower effort
 * so a switch does not silently spend a larger budget.
 */
export function constrainThinkingLevel(requested: ThinkingLevel, supported?: ThinkingLevel[]): ThinkingLevel {
  if (supported === undefined || supported.includes(requested)) return requested
  if (supported.length === 0) return 'off'
  const origin = THINKING_LEVEL_IDS.indexOf(requested)
  let best = supported[0]!
  let bestDistance = Infinity
  for (const level of supported) {
    const distance = Math.abs(THINKING_LEVEL_IDS.indexOf(level) - origin)
    const better = distance < bestDistance
      || (distance === bestDistance && THINKING_LEVEL_IDS.indexOf(level) < THINKING_LEVEL_IDS.indexOf(best))
    if (better) {
      best = level
      bestDistance = distance
    }
  }
  return best
}

/** Level that should be stored and sent for this model. */
export function resolveSessionThinkingLevel(model: ThinkingModelRef | undefined, requested: ThinkingLevel): ThinkingLevel {
  const capability = modelThinkingCapability(model)
  if (capability.mode === 'unsupported') return 'off'
  if (capability.mode === 'always-on') return capability.requestLevel ?? 'low'
  return constrainThinkingLevel(requested, capability.levels)
}

/**
 * Pi `thinkingLevelMap` for a custom endpoint. Allowed stops pass through
 * under their own name. `off` is omitted when it is allowed, so the provider
 * disables thinking instead of receiving a literal `"off"` effort. Disallowed
 * stops are `null` and Pi will not select them.
 */
export function thinkingLevelMapForLevels(levels: readonly ThinkingLevel[]): Record<string, string | null> {
  const allowed = new Set(levels)
  const map: Record<string, string | null> = {}
  for (const level of UPSTREAM_LEVELS) {
    if (level === 'off') {
      if (!allowed.has('off')) map.off = null
      continue
    }
    map[level] = allowed.has(level) ? level : null
  }
  return map
}

export function thinkingFieldsFromUpstream(model: ThinkingModelRef): {
  supportsThinking: boolean
  supportedThinkingLevels: ThinkingLevel[]
  thinkingMode: ThinkingMode
  thinkingSource?: ThinkingCapabilitySource
} {
  const capability = modelThinkingCapability(model)
  return {
    supportsThinking: capability.mode !== 'unsupported',
    supportedThinkingLevels: capability.mode === 'levels' ? capability.levels : [],
    thinkingMode: capability.mode,
    ...(capability.source === 'provider-api' || capability.source === 'explicit' ? { thinkingSource: capability.source } : {}),
  }
}
