import type { ConfirmDialogSpec } from '@craft-agent/server-core/transport'

type Handler = (spec: ConfirmDialogSpec) => Promise<{ response: number }>

/** A missing/unmounted renderer can never approve a server confirmation. */
export function createConfirmationBridge() {
  let handler: Handler | undefined
  let cancelPending: (() => void) | undefined
  return {
    register(next: Handler) {
      cancelPending?.()
      handler = next
      return () => {
        if (handler !== next) return
        handler = undefined
        cancelPending?.()
      }
    },
    request(spec: ConfirmDialogSpec): Promise<{ response: number }> {
      const cancelled = { response: spec.cancelId ?? 0 }
      if (!handler || cancelPending) return Promise.resolve(cancelled)
      const activeHandler = handler
      return new Promise(resolve => {
        let settled = false
        const finish = (result: { response: number }) => {
          if (settled) return
          settled = true
          cancelPending = undefined
          resolve(result)
        }
        cancelPending = () => finish(cancelled)
        Promise.resolve().then(() => settled ? cancelled : activeHandler(spec)).then(result => {
          finish(Number.isInteger(result?.response) && result.response >= 0 && result.response < spec.buttons.length ? result : cancelled)
        }, () => finish(cancelled))
      })
    },
  }
}
