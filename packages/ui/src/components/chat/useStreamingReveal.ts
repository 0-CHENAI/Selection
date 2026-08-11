/**
 * React hook: time-aware streaming reveal decision for response cards.
 *
 * Pure gate logic lives in stream-buffer.ts; this hook ensures min/max time
 * windows re-evaluate even when the model stalls (no new tokens).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getNextBufferCheckDelayMs,
  shouldShowContent,
  type BufferReason,
} from './stream-buffer'

export interface StreamingRevealState {
  shouldShow: boolean
  reason: BufferReason
  wordCount: number
  /** Effective stream start used for the decision (caller or local fallback) */
  effectiveStartTime: number | undefined
}

/**
 * @param text - Accumulated assistant text
 * @param isStreaming - Whether the stream is still open
 * @param streamStartTime - Preferred clock from the message pipeline
 */
export function useStreamingReveal(
  text: string | undefined,
  isStreaming: boolean,
  streamStartTime?: number,
): StreamingRevealState {
  const [tick, setTick] = useState(0)
  // Fallback clock when streamStartTime is missing — captured on first streaming frame
  const localStartRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (isStreaming) {
      if (localStartRef.current == null) {
        localStartRef.current = streamStartTime ?? Date.now()
        // Force a re-check with the captured clock
        setTick((n) => n + 1)
      }
    } else {
      localStartRef.current = undefined
    }
  }, [isStreaming, streamStartTime])

  const effectiveStartTime = streamStartTime ?? localStartRef.current

  const decision = useMemo(() => {
    return shouldShowContent(text ?? '', isStreaming, effectiveStartTime)
  }, [text, isStreaming, effectiveStartTime, tick])

  useEffect(() => {
    if (!isStreaming || decision.shouldShow) return

    const delay = getNextBufferCheckDelayMs(decision, effectiveStartTime)
    if (delay == null) return

    const id = window.setTimeout(() => {
      setTick((n) => n + 1)
    }, delay)
    return () => window.clearTimeout(id)
  }, [isStreaming, decision.shouldShow, decision.reason, decision.wordCount, effectiveStartTime, text, tick])

  return {
    shouldShow: decision.shouldShow,
    reason: decision.reason,
    wordCount: decision.wordCount,
    effectiveStartTime,
  }
}
