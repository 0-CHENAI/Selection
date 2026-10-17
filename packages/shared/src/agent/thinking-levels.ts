/**
 * Thinking Level Configuration
 *
 * Ordered effort stops for extended reasoning:
 * - Off: No extended thinking
 * - Minimal: Smallest effort a model actually accepts (GPT-5, Gemini 3 Flash, …)
 * - Low: Light reasoning, faster responses
 * - Medium: Balanced speed and reasoning (default)
 * - High: Deep reasoning for complex tasks
 * - XHigh: Extra-high reasoning for models that advertise it
 * - Max: Maximum effort reasoning
 *
 * Which stops appear is per model. `thinking-capabilities.ts` reads upstream
 * `thinkingLevelMap` / `supportedReasoningEfforts` first and falls back to one
 * capability table. The selected stop is passed through to Pi, which maps it
 * onto the provider wire format (OpenAI `reasoning_effort`, Anthropic `effort`
 * or `budget_tokens`, Gemini `thinkingLevel` / `thinkingBudget`, DeepSeek and
 * Kimi thinking flags). Stops the model does not accept are not offered, so
 * the request does not rely on a silent upstream clamp.
 */

/**
 * Ordered list of valid thinking level IDs. Single source of truth — the
 * `ThinkingLevel` type, `THINKING_LEVELS` metadata, the Zod schema in
 * `validators.ts`, and runtime validation/error messages all derive from this.
 *
 * Order is significant: it determines UI ordering (off → max) and distance
 * when a saved level has to move to the nearest legal stop.
 */
export const THINKING_LEVEL_IDS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVEL_IDS)[number];

export interface ThinkingLevelDefinition {
  id: ThinkingLevel;
  /** Translation key for the display name (resolve with t() at render site) */
  nameKey: string;
  /** Translation key for the description (resolve with t() at render site) */
  descriptionKey: string;
}

/**
 * Available thinking levels with display metadata.
 * Used in UI dropdowns and for validation.
 *
 * Labels use translation keys — resolve with t(level.nameKey) in components.
 */
export const THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'off', nameKey: 'thinking.off', descriptionKey: 'thinking.offDesc' },
  { id: 'minimal', nameKey: 'thinking.minimal', descriptionKey: 'thinking.minimalDesc' },
  { id: 'low', nameKey: 'thinking.low', descriptionKey: 'thinking.lowDesc' },
  { id: 'medium', nameKey: 'thinking.medium', descriptionKey: 'thinking.mediumDesc' },
  { id: 'high', nameKey: 'thinking.high', descriptionKey: 'thinking.highDesc' },
  { id: 'xhigh', nameKey: 'thinking.xhigh', descriptionKey: 'thinking.xhighDesc' },
  { id: 'max', nameKey: 'thinking.max', descriptionKey: 'thinking.maxDesc' },
] as const;

/** Default thinking level for new sessions when workspace has no default */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

/**
 * Map ThinkingLevel to Anthropic SDK effort parameter.
 * Used with adaptive thinking (thinking: { type: 'adaptive' }).
 * Returns null for 'off' (thinking should be disabled entirely).
 */
export const THINKING_TO_EFFORT: Record<ThinkingLevel, 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null> = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/**
 * Token budgets per model family.
 * Used as fallback for models that don't support adaptive thinking
 * (e.g., non-Claude models via OpenRouter/Ollama).
 *
 * Haiku max is 8k per Anthropic docs.
 * Sonnet/Opus can use up to 128k, but Anthropic recommends ≤32k for real-time use
 * (above 32k, batch processing is suggested to avoid timeouts).
 */
const TOKEN_BUDGETS = {
  haiku: {
    off: 0,
    minimal: 1_000,
    low: 2_000,
    medium: 4_000,
    high: 6_000,
    xhigh: 7_000,
    max: 8_000,
  },
  default: {
    off: 0,
    minimal: 2_000,
    low: 4_000,
    medium: 10_000,
    high: 20_000,
    xhigh: 26_000,
    max: 32_000,
  },
} as const;

/**
 * Get the thinking token budget for a given level and model.
 * Used as fallback for models that don't support adaptive thinking.
 *
 * @param level - The thinking level
 * @param modelId - The model ID (e.g., 'claude-haiku-4-5-20251001')
 * @returns Number of thinking tokens to allocate
 */
export function getThinkingTokens(level: ThinkingLevel, modelId: string): number {
  const isHaiku = modelId.toLowerCase().includes('haiku');
  const budgets = isHaiku ? TOKEN_BUDGETS.haiku : TOKEN_BUDGETS.default;
  return budgets[level];
}

/**
 * Get the translation key for a thinking level's display name.
 * Resolve with t() or i18n.t() at the call site.
 */
export function getThinkingLevelNameKey(level: ThinkingLevel): string {
  const def = THINKING_LEVELS.find((l) => l.id === level);
  return def?.nameKey ?? `thinking.${level}`;
}

/**
 * Validate that a value is a valid ThinkingLevel.
 */
export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVEL_IDS as readonly string[]).includes(value);
}

/**
 * Normalize a persisted thinking level value, handling legacy values.
 * Maps the old 'think' value to 'medium' for backward compatibility.
 *
 * TODO: Remove the legacy 'think' compatibility path after old persisted session
 * and workspace data has realistically aged out across upgrades.
 *
 * @returns The normalized ThinkingLevel, or undefined if the value is invalid
 */
export function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === 'think') return 'medium';
  if (isValidThinkingLevel(value)) return value;
  return undefined;
}

export {
  constrainThinkingLevel,
  modelThinkingCapability,
  modelThinkingLevels,
  resolveSessionThinkingLevel,
  thinkingFieldsFromUpstream,
  thinkingLevelMapForLevels,
  type ThinkingCapability,
  type ThinkingMode,
  type ThinkingModelRef,
} from './thinking-capabilities.ts';
