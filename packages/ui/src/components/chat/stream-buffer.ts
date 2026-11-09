/**
 * Streaming display buffer for assistant response cards.
 *
 * Goals:
 * - Show content quickly enough to feel live (especially CJK, which has no spaces)
 * - Avoid flashing half-token noise in the first ~100ms
 * - Throttle markdown re-renders without feeling "stuck"
 * - Time-based gates (min/max buffer) must re-evaluate even when tokens stall
 */

export const BUFFER_CONFIG = {
  /** ~English words, or CJK chars/2 (see measureContentUnits) */
  MIN_UNITS_STANDARD: 8,
  MIN_UNITS_CODE: 4,
  MIN_UNITS_LIST: 5,
  MIN_UNITS_QUESTION: 3,
  MIN_UNITS_HEADER: 4,
  /** Short anti-flash delay only */
  MIN_BUFFER_MS: 100,
  /** Force-show if we have any real content by this time */
  MAX_BUFFER_MS: 600,
  TIMEOUT_MIN_UNITS: 1,
  /** Show regardless of structure once this large */
  HIGH_UNIT_COUNT: 14,
  /** Re-render cadence while streaming (ms) */
  CONTENT_THROTTLE_MS: 50,
} as const

export type BufferReason =
  | 'complete'
  | 'min_time'
  | 'timeout'
  | 'code_block'
  | 'list'
  | 'header'
  | 'question'
  | 'threshold_met'
  | 'high_word_count'
  | 'buffering'
  | 'empty'

/** CJK Unified Ideographs + Hangul + Kana (common East-Asian scripts without spaces) */
const CJK_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g

/**
 * Content "units" for buffer decisions.
 * - Space-separated Latin tokens ≈ 1 unit each
 * - CJK/Kana/Hangul characters ≈ 0.5 unit each (2 chars ≈ 1 English word)
 * - CJK punctuation is ignored for unit counting (does not inflate length)
 */
export function measureContentUnits(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0

  let units = 0
  for (const token of trimmed.split(/\s+/).filter(Boolean)) {
    const cjkMatches = token.match(CJK_CHAR_RE)
    const cjkCount = cjkMatches ? cjkMatches.length : 0
    // Strip CJK from token, then strip common CJK/Latin punctuation for "latin run" check
    const withoutCjk = token.replace(CJK_CHAR_RE, '')
    const latinish = withoutCjk.replace(/[\p{P}\p{S}\p{Z}]+/gu, '')
    if (cjkCount > 0) units += Math.ceil(cjkCount / 2)
    if (latinish.length > 0) units += 1
  }
  return units
}

/** @deprecated Use measureContentUnits */
export function countWords(text: string): number {
  return measureContentUnits(text)
}

export function hasCodeBlock(text: string): boolean {
  return /```/.test(text)
}

export function hasList(text: string): boolean {
  return /^\s*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)
}

export function hasHeader(text: string): boolean {
  return /^#{1,4}\s/m.test(text)
}

export function hasStructure(text: string): boolean {
  // Latin + CJK sentence endings (anywhere near the end is fine for streaming)
  if (/[.!?:。！？；：]\s*$/.test(text.trimEnd())) return true
  if (/\n\s*\n/.test(text)) return true
  if (/\n\s*#{1,4}\s/.test(text)) return true
  if (hasCodeBlock(text)) return true
  return false
}

export function isQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim())
}

/**
 * Resolve stream clock.
 * - Prefer caller-provided streamStartTime
 * - If missing while streaming, treat min window as already satisfied so unit
 *   thresholds can fire (avoids permanent buffer when timestamp was never set)
 */
export function resolveStreamElapsedMs(
  streamStartTime: number | undefined,
  now: number = Date.now(),
): { elapsed: number; hasClock: boolean } {
  if (streamStartTime != null && Number.isFinite(streamStartTime)) {
    return { elapsed: Math.max(0, now - streamStartTime), hasClock: true }
  }
  // No clock: skip min_time gate by reporting elapsed past MIN_BUFFER_MS
  return { elapsed: BUFFER_CONFIG.MIN_BUFFER_MS, hasClock: false }
}

/**
 * Decide whether buffered streaming content should appear in the response card.
 */
export function shouldShowContent(
  text: string,
  isStreaming: boolean,
  streamStartTime?: number,
  now: number = Date.now(),
): { shouldShow: boolean; reason: BufferReason; wordCount: number } {
  const wordCount = measureContentUnits(text)

  if (!isStreaming) {
    return { shouldShow: true, reason: 'complete', wordCount }
  }

  // Empty stream — keep buffering indicator
  if (!text.trim()) {
    return { shouldShow: false, reason: 'empty', wordCount: 0 }
  }

  const { elapsed, hasClock } = resolveStreamElapsedMs(streamStartTime, now)

  // Only enforce min flash window when we have a real start timestamp
  if (hasClock && elapsed < BUFFER_CONFIG.MIN_BUFFER_MS) {
    return { shouldShow: false, reason: 'min_time', wordCount }
  }

  // Force-show after max wait if we have any measured content (or non-empty text)
  if (hasClock && elapsed > BUFFER_CONFIG.MAX_BUFFER_MS && wordCount >= BUFFER_CONFIG.TIMEOUT_MIN_UNITS) {
    return { shouldShow: true, reason: 'timeout', wordCount }
  }
  // No clock but non-empty: allow timeout path via unit thresholds only;
  // if content is tiny and unstructured, still show after max window using "now" is wrong.
  // Without clock, fall through to unit gates; if still buffering, caller should
  // use a local start fallback (see useStreamingReveal).

  if (hasCodeBlock(text) && wordCount >= BUFFER_CONFIG.MIN_UNITS_CODE) {
    return { shouldShow: true, reason: 'code_block', wordCount }
  }

  if (hasHeader(text) && wordCount >= BUFFER_CONFIG.MIN_UNITS_HEADER) {
    return { shouldShow: true, reason: 'header', wordCount }
  }

  if (hasList(text) && wordCount >= BUFFER_CONFIG.MIN_UNITS_LIST) {
    return { shouldShow: true, reason: 'list', wordCount }
  }

  if (isQuestion(text) && wordCount >= BUFFER_CONFIG.MIN_UNITS_QUESTION) {
    return { shouldShow: true, reason: 'question', wordCount }
  }

  if (wordCount >= BUFFER_CONFIG.MIN_UNITS_STANDARD && hasStructure(text)) {
    return { shouldShow: true, reason: 'threshold_met', wordCount }
  }

  if (wordCount >= BUFFER_CONFIG.HIGH_UNIT_COUNT) {
    return { shouldShow: true, reason: 'high_word_count', wordCount }
  }

  // No clock + non-empty content stuck in buffering: show after soft min units
  // so missing streamStartTime cannot hide the card forever.
  if (!hasClock && wordCount >= BUFFER_CONFIG.TIMEOUT_MIN_UNITS) {
    return { shouldShow: true, reason: 'timeout', wordCount }
  }

  return { shouldShow: false, reason: 'buffering', wordCount }
}

export function isResponseTextBuffering(
  text: string | undefined,
  isStreaming: boolean | undefined,
  streamStartTime?: number,
  now: number = Date.now(),
): boolean {
  if (!isStreaming || text === undefined) return false
  return !shouldShowContent(text, true, streamStartTime, now).shouldShow
}

/**
 * Next timer delay (ms) to re-check buffer decision while still hidden.
 * Returns null when no timer is needed.
 */
export function getNextBufferCheckDelayMs(
  decision: { shouldShow: boolean; reason: BufferReason },
  streamStartTime: number | undefined,
  now: number = Date.now(),
): number | null {
  if (decision.shouldShow) return null

  const { elapsed, hasClock } = resolveStreamElapsedMs(streamStartTime, now)

  if (decision.reason === 'empty') {
    // Wait for first tokens — parent re-renders on text; no tight poll
    return null
  }

  if (decision.reason === 'min_time' && hasClock) {
    return Math.max(16, BUFFER_CONFIG.MIN_BUFFER_MS - elapsed + 1)
  }

  if (hasClock && elapsed <= BUFFER_CONFIG.MAX_BUFFER_MS) {
    return Math.max(16, BUFFER_CONFIG.MAX_BUFFER_MS - elapsed + 1)
  }

  // Past max or no clock but still buffering (rare): light recheck
  return 100
}
