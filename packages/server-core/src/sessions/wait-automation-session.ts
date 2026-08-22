export type AutomationWaitReason = 'complete' | 'interrupted' | 'error' | 'timeout'

export interface AutomationWaitEvent {
  sessionId: string
  reason: AutomationWaitReason
  finalText?: string
  tokenUsage?: unknown
}

export interface AutomationWaitOutcome {
  reason: AutomationWaitReason
  finalText?: string
  tokenUsage?: unknown
}

/**
 * Wait for a spawned automation session to complete via onSessionComplete.
 * Timeout and abort resolve with a reason — they do not throw.
 */
export async function waitForAutomationSessionCompletion(opts: {
  sessionId: string
  timeoutMs: number
  subscribe: (listener: (evt: AutomationWaitEvent) => void) => () => void
  signal?: AbortSignal
}): Promise<AutomationWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let unsub = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: AutomationWaitOutcome) => {
      if (settled) return
      settled = true
      unsub()
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = () => finish({ reason: 'interrupted' })

    unsub = opts.subscribe((evt) => {
      if (evt.sessionId !== opts.sessionId) return
      finish({
        reason: evt.reason,
        finalText: evt.finalText,
        tokenUsage: evt.tokenUsage,
      })
    })

    timer = setTimeout(() => finish({ reason: 'timeout' }), opts.timeoutMs)
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
