/**
 * Per-model thinking stops.
 *
 * Priority:
 * 1. Explicit `thinkingMode` / `supportedThinkingLevels` stored on the model
 *    (custom endpoints, and catalogs already stamped from upstream).
 * 2. Upstream metadata: `thinkingLevelMap` (Pi SDK) or `supportedReasoningEfforts`
 *    (Copilot and similar OAuth model lists).
 * 3. The fallback table in this file, matched on the bare model id.
 * 4. A boolean `supportsThinking` / `reasoning` flag when nothing more specific exists.
 *
 * Pi still translates a stop into the provider parameter (`reasoning_effort`,
 * Anthropic `effort` / `budget_tokens`, Gemini `thinkingLevel` / `thinkingBudget`,
 * DeepSeek `thinking`, Kimi effort). We only hand it a stop the model accepts.
 */
import {
  THINKING_LEVEL_IDS,
  THINKING_LEVELS,
  type ThinkingLevel,
  type ThinkingLevelDefinition,
} from './thinking-levels.ts';

export type ThinkingMode = 'unsupported' | 'always-on' | 'levels';

export interface ThinkingCapability {
  mode: ThinkingMode;
  /** Slider stops, in canonical order. Empty unless `mode` is `levels`. */
  levels: ThinkingLevel[];
  /** Two stops, and the first is off: the control is a switch, not a scale. */
  binary?: boolean;
  /** Effort to send when the model thinks and the user cannot pick a stop. */
  requestLevel?: ThinkingLevel;
}

export interface ThinkingModelRef {
  id?: string;
  reasoning?: boolean;
  supportsThinking?: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  thinkingMode?: ThinkingMode;
  thinkingLevelMap?: Record<string, string | null> | null;
  api?: string;
  supportsReasoningEffort?: boolean;
  thinkingFormat?: string;
  supportedReasoningEfforts?: string[];
}

const UPSTREAM_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Stops Pi accepts when a model reasons and its map does not say otherwise.
 * `xhigh` and `max` stay hidden until a map opts in.
 */
const GENERIC_REASONING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];

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
};

function asLevel(value: string): ThinkingLevel | undefined {
  return (THINKING_LEVEL_IDS as readonly string[]).includes(value) ? value as ThinkingLevel : undefined;
}

/** Strip provider prefixes so `pi/openai/gpt-5.4` and Bedrock ids share one key. */
export function bareThinkingModelId(modelId: string): string {
  let value = modelId.trim().toLowerCase();
  if (value.startsWith('pi/')) value = value.slice(3);
  value = value.replace(/^(global|us|eu)\.anthropic\./, '');
  value = value.replace(/^anthropic\./, '');
  const slash = value.lastIndexOf('/');
  if (slash >= 0) value = value.slice(slash + 1);
  value = value.replace(/:[\w.+-]+$/, '');
  value = value.replace(/claude-(opus|sonnet|haiku)-(\d+)\.(\d+)/, 'claude-$1-$2-$3');
  return value;
}

function ordered(levels: Iterable<ThinkingLevel>): ThinkingLevel[] {
  const selected = new Set(levels);
  return THINKING_LEVEL_IDS.filter(level => selected.has(level));
}

function levelsCapability(levels: ThinkingLevel[]): ThinkingCapability {
  const unique = ordered(levels);
  return {
    mode: 'levels',
    levels: unique,
    binary: unique.length === 2 && unique[0] === 'off',
  };
}

function unsupported(): ThinkingCapability {
  return { mode: 'unsupported', levels: [] };
}

function alwaysOn(): ThinkingCapability {
  return { mode: 'always-on', levels: [], requestLevel: 'low' };
}

/**
 * Same acceptance rule as Pi's `getSupportedThinkingLevels`: missing stops
 * through `high` use the provider default, while `xhigh` and `max` are opt-in.
 * Stops that share one wire value collapse to the canonical name (`low` wins
 * over Anthropic's default `minimal` → `low`).
 */
export function levelsFromThinkingLevelMap(
  reasoning: boolean,
  map: Record<string, string | null> | null | undefined,
  api?: string,
): ThinkingLevel[] {
  if (!reasoning) return [];
  const visible = UPSTREAM_LEVELS.filter(level => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
  const wireOf = (level: typeof UPSTREAM_LEVELS[number]): string => {
    const mapped = map?.[level];
    if (typeof mapped === 'string' && mapped.trim()) return mapped.trim().toLowerCase();
    if (api === 'anthropic-messages' && level === 'minimal') return 'low';
    return level;
  };
  const wires = visible.map(level => ({ level, wire: wireOf(level) }));
  const kept = new Set<ThinkingLevel>();
  const seen = new Set<string>();
  for (const entry of wires) {
    if (seen.has(entry.wire)) continue;
    const canonical = wires.find(other => other.level === entry.wire)?.level ?? asLevel(entry.wire);
    const chosen = canonical && visible.includes(canonical as typeof entry.level) ? canonical : entry.level;
    const chosenLevel = asLevel(chosen) ?? asLevel(entry.level);
    if (!chosenLevel) continue;
    seen.add(entry.wire);
    kept.add(chosenLevel);
  }
  return ordered(kept);
}

function booleanThinking(model: ThinkingModelRef): ThinkingCapability | undefined {
  const format = model.thinkingFormat;
  const toggle = model.supportsReasoningEffort === false
    && (format === 'deepseek' || format === 'together' || format === 'string-thinking' || format === 'qwen');
  if (!toggle) return undefined;
  if (model.reasoning === false || model.supportsThinking === false) return unsupported();
  if (model.thinkingLevelMap?.off === null) return alwaysOn();
  return levelsCapability(['off', 'high']);
}

function fromEfforts(efforts: string[]): ThinkingCapability {
  const found = new Set<ThinkingLevel>();
  for (const raw of efforts) {
    const key = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
    const level = EFFORT_ALIASES[key] ?? EFFORT_ALIASES[key.replace(/-/g, '_')];
    if (level && level !== 'off') found.add(level);
  }
  if (found.size === 0) return unsupported();
  return levelsCapability(['off', ...found]);
}

function explicitLevels(levels: ThinkingLevel[]): ThinkingCapability {
  const valid = ordered(levels.filter(level => asLevel(level)));
  if (valid.length === 0) return unsupported();
  return levelsCapability(valid);
}

/**
 * Capability table used when the model list did not include a thinking map.
 * Patterns follow the Pi SDK 1.2.0 catalogs (API key and OAuth share an id,
 * except where the map itself differs — that case is stamped at fetch time).
 */
export function fallbackThinkingCapability(modelId: string): ThinkingCapability | undefined {
  const id = bareThinkingModelId(modelId);
  if (!id) return undefined;

  if (/^(gpt-3\.5|gpt-4($|[.-])|gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o)/.test(id)) return unsupported();

  if (/claude-(fable|mythos)/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max']);
  if (/claude-(opus|sonnet|haiku)-5-5/.test(id) || /claude-(opus|haiku|sonnet)-5($|[^0-9])/.test(id)) {
    return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max']);
  }
  if (/claude-(opus-4-8|opus-4-7|sonnet-5)($|[^0-9])/.test(id)) {
    return levelsCapability(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  }
  if (/claude-(opus-4-6|sonnet-4-6)/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'max']);
  if (/claude-(haiku-4|sonnet-4-5|opus-4-5|opus-4-1|opus-4$)/.test(id)) {
    return levelsCapability(['off', 'low', 'medium', 'high']);
  }
  if (id.startsWith('claude-')) return levelsCapability(['off', 'low', 'medium', 'high']);

  if (/^gpt-5-pro$/.test(id)) return levelsCapability(['high']);
  if (/^gpt-5$|^gpt-5-(mini|nano)$/.test(id)) return levelsCapability(['minimal', 'low', 'medium', 'high']);
  if (/^gpt-5\.1($|[^0-9])/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high']);
  if (/gpt-5\.(2|4|5)-pro/.test(id)) return levelsCapability(['medium', 'high', 'xhigh']);
  if (/^gpt-5\.(2|3|4|5)/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'xhigh']);
  if (/^gpt-6-astra|^gpt-6\.1/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh', 'max']);
  if (/^gpt-5\.6|^gpt-6/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  if (/^o[134]($|[-.])/.test(id)) return levelsCapability(['low', 'medium', 'high']);

  if (/gemini-2\.5/.test(id)) return levelsCapability(['off', 'minimal', 'low', 'medium', 'high']);
  if (/gemma-?4/.test(id)) return levelsCapability(['minimal', 'high']);
  if (/gemini-3(\.1)?-(flash|flash-lite|flash-preview|flash-lite-preview)|gemini-3\.(5|6)-flash|gemini-flash/.test(id)) {
    return levelsCapability(['minimal', 'low', 'medium', 'high']);
  }
  if (/gemini-3(\.1)?-pro|gemini-3\.(7|8)/.test(id)) return levelsCapability(['low', 'medium', 'high']);
  if (id.startsWith('gemini-') || id.startsWith('gemma-')) return levelsCapability(GENERIC_REASONING_LEVELS);

  if (/deepseek-(r1|reasoner)/.test(id)) return alwaysOn();
  if (/deepseek-(v4-pro|chat-reasoner)/.test(id)) return levelsCapability(['off', 'high', 'max']);
  if (/deepseek-(v4-flash|flash)/.test(id)) return levelsCapability(['off', 'low', 'high', 'max']);
  if (id.startsWith('deepseek-')) return levelsCapability(['off', 'high', 'max']);

  if (/kimi-k2\.7|kimi-k2-7/.test(id)) return alwaysOn();
  if (/kimi-k2\.6/.test(id)) return levelsCapability(['off', 'high']);
  if (/kimi-k3|^k3($|[-.])|kimi-for-coding$|k3-256k/.test(id)) return levelsCapability(['low', 'high', 'max']);
  if (/kimi/.test(id)) return levelsCapability(['off', 'low', 'medium', 'high']);

  if (/^grok-4\.(6|7)/.test(id)) return levelsCapability(['low', 'medium', 'high', 'xhigh']);
  if (/^grok-4/.test(id) || id.startsWith('grok-')) return levelsCapability(['low', 'medium', 'high']);

  if (/glm-5\.2/.test(id)) return levelsCapability(['off', 'high', 'max']);
  if (/glm-5\.3/.test(id)) return levelsCapability(['low', 'high', 'max']);
  if (/^glm-|^minimax-m/.test(id)) return levelsCapability(GENERIC_REASONING_LEVELS);

  return undefined;
}

function deriveUpstream(model: ThinkingModelRef): ThinkingCapability | undefined {
  const toggle = booleanThinking(model);
  if (toggle) return toggle;
  if (!model.thinkingLevelMap) return undefined;
  const reasoning = model.reasoning !== false && model.supportsThinking !== false;
  const levels = levelsFromThinkingLevelMap(reasoning, model.thinkingLevelMap, model.api);
  if (!reasoning || levels.length === 0) return unsupported();
  return levelsCapability(levels);
}

export function modelThinkingCapability(model?: ThinkingModelRef): ThinkingCapability {
  if (!model) return levelsCapability([...THINKING_LEVEL_IDS]);
  if (model.thinkingMode === 'always-on') return alwaysOn();
  if (model.thinkingMode === 'unsupported') return unsupported();
  if (model.supportedThinkingLevels !== undefined) return explicitLevels(model.supportedThinkingLevels);
  if (model.supportedReasoningEfforts) return fromEfforts(model.supportedReasoningEfforts);

  const upstream = deriveUpstream(model);
  if (upstream) return upstream;

  if (model.reasoning === false || model.supportsThinking === false) return unsupported();

  if (model.id) {
    const fallback = fallbackThinkingCapability(model.id);
    if (fallback) return fallback;
  }

  if (model.reasoning === true || model.supportsThinking === true) return levelsCapability(GENERIC_REASONING_LEVELS);
  if (model.id) return unsupported();
  return levelsCapability([...THINKING_LEVEL_IDS]);
}

export function modelThinkingLevels(model?: ThinkingModelRef): ThinkingLevelDefinition[] {
  const capability = modelThinkingCapability(model);
  if (capability.mode !== 'levels') return [];
  return THINKING_LEVELS.filter(level => capability.levels.includes(level.id));
}

/**
 * Move `requested` onto a legal stop. Equal distance keeps the lower effort
 * so a switch does not silently spend a larger budget.
 */
export function constrainThinkingLevel(requested: ThinkingLevel, supported?: ThinkingLevel[]): ThinkingLevel {
  if (supported === undefined || supported.includes(requested)) return requested;
  if (supported.length === 0) return 'off';
  const origin = THINKING_LEVEL_IDS.indexOf(requested);
  let best = supported[0]!;
  let bestDistance = Infinity;
  for (const level of supported) {
    const distance = Math.abs(THINKING_LEVEL_IDS.indexOf(level) - origin);
    const better = distance < bestDistance
      || (distance === bestDistance && THINKING_LEVEL_IDS.indexOf(level) < THINKING_LEVEL_IDS.indexOf(best));
    if (better) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** Level that should be stored and sent for this model. */
export function resolveSessionThinkingLevel(model: ThinkingModelRef | undefined, requested: ThinkingLevel): ThinkingLevel {
  const capability = modelThinkingCapability(model);
  if (capability.mode === 'unsupported') return 'off';
  if (capability.mode === 'always-on') return capability.requestLevel ?? 'low';
  return constrainThinkingLevel(requested, capability.levels);
}

/**
 * Pi `thinkingLevelMap` for a custom endpoint. Allowed stops pass through
 * under their own name. `off` is omitted when it is allowed, so the provider
 * disables thinking instead of receiving a literal `"off"` effort. Disallowed
 * stops are `null` and Pi will not select them.
 */
export function thinkingLevelMapForLevels(levels: readonly ThinkingLevel[]): Record<string, string | null> {
  const allowed = new Set(levels);
  const map: Record<string, string | null> = {};
  for (const level of UPSTREAM_LEVELS) {
    if (level === 'off') {
      if (!allowed.has('off')) map.off = null;
      continue;
    }
    map[level] = allowed.has(level) ? level : null;
  }
  return map;
}

export function thinkingFieldsFromUpstream(model: ThinkingModelRef): {
  supportsThinking: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  thinkingMode: ThinkingMode;
} {
  const capability = modelThinkingCapability(model);
  return {
    supportsThinking: capability.mode !== 'unsupported',
    supportedThinkingLevels: capability.mode === 'levels' ? capability.levels : [],
    thinkingMode: capability.mode,
  };
}
