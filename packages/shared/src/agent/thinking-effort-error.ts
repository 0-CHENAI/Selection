/**
 * Detect a provider rejection that names an unsupported thinking effort.
 *
 * The match has to mention reasoning effort / thinking level (or an explicit
 * "supported efforts" list). A generic sentence that merely contains the word
 * "effort" is left alone.
 */
import type { ThinkingLevel } from './thinking-levels.ts'

const LEVEL_ALIASES: Record<string, ThinkingLevel> = {
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

const SIGNAL = /reasoning[_ -]?effort|thinking[_ -]?level|thinking[_ -]?budget|unsupported effort|invalid effort|effort (?:is |must |'|"|`)|supported (?:reasoning[_ -]?)?efforts|supported values|allowed (?:reasoning[_ -]?)?efforts/i

export interface UnsupportedThinkingEffort {
  /** Levels the provider said it accepts, when the error lists them. */
  allowed?: ThinkingLevel[]
  /** The stop the provider rejected, when the error names one. */
  rejected?: ThinkingLevel
}

function asLevel(token: string): ThinkingLevel | undefined {
  const key = token.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return LEVEL_ALIASES[key] ?? LEVEL_ALIASES[key.replace(/-/g, '_')]
}

function levelsIn(text: string): ThinkingLevel[] {
  const found: ThinkingLevel[] = []
  const seen = new Set<ThinkingLevel>()
  const pattern = /['"`]?([A-Za-z][A-Za-z-]{1,20})['"`]?/g
  for (const match of text.matchAll(pattern)) {
    const level = asLevel(match[1] ?? '')
    if (!level || seen.has(level)) continue
    seen.add(level)
    found.push(level)
  }
  return found
}

function allowedList(message: string): ThinkingLevel[] | undefined {
  const match = message.match(/(?:supported (?:reasoning[_ -]?)?efforts|supported values|allowed (?:reasoning[_ -]?)?efforts|must be one of|valid (?:values|efforts)(?: are)?|one of)\s*[:：]?\s*([^.。\n]+)/i)
  if (!match?.[1]) return undefined
  const levels = levelsIn(match[1])
  return levels.length > 0 ? levels : undefined
}

function rejectedLevel(message: string): ThinkingLevel | undefined {
  const quoted = message.match(/(?:reasoning[_ -]?effort|thinking[_ -]?level|effort)\s*(?:of|is|was|=|:)?\s*['"`]([A-Za-z][A-Za-z-]{1,20})['"`]/i)
  const named = quoted?.[1] ? asLevel(quoted[1]) : undefined
  if (named) return named
  const invalid = message.match(/(?:invalid|unsupported|unknown|unrecognized)\s+(?:reasoning[_ -]?effort|thinking[_ -]?level|effort)\s*[:：]?\s*['"`]?([A-Za-z][A-Za-z-]{1,20})['"`]?/i)
  return invalid?.[1] ? asLevel(invalid[1]) : undefined
}

export function parseUnsupportedThinkingEffort(message: string): UnsupportedThinkingEffort | undefined {
  const text = message.trim()
  if (!text || !SIGNAL.test(text)) return undefined
  const allowed = allowedList(text)
  const rejected = rejectedLevel(text)
  if (!allowed?.length && !rejected) return undefined
  return {
    ...(allowed?.length ? { allowed } : {}),
    ...(rejected ? { rejected } : {}),
  }
}
