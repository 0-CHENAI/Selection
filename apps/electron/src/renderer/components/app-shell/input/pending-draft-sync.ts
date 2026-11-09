/** Persist only edits that have not already been delivered to the draft owner. */
export function createPendingDraftSync(onChange: (text: string) => void, delay = 300) {
  let pending: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = undefined
  }
  const flush = () => {
    const text = pending
    cancel()
    if (text !== undefined) onChange(text)
  }
  return {
    schedule(text: string) {
      cancel()
      pending = text
      timer = setTimeout(flush, delay)
    },
    flush,
    cancel,
  }
}
