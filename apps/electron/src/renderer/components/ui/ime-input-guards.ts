/**
 * CJK IME first-key guards (#84).
 *
 * Chromium can fire a printable keydown + input on an empty contenteditable
 * before `compositionstart`. Committing that letter into React state rewrites
 * the DOM and prevents composition. Defer the commit until we know the key
 * was not starting an IME session.
 */

export function isImeProcessKey(event: { keyCode?: number; which?: number }): boolean {
  return event.keyCode === 229 || event.which === 229
}

export function isUnmodifiedPrintableKey(event: {
  key?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  const key = event.key ?? ''
  return key.length === 1
}

export function createImeFirstKeyGate() {
  let composing = false
  let pendingPrintableKey = false

  const onKeyDown = (event: {
    key?: string
    keyCode?: number
    which?: number
    isComposing?: boolean
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
  }) => {
    if (event.isComposing || isImeProcessKey(event)) {
      composing = true
      pendingPrintableKey = false
      return
    }
    if (isUnmodifiedPrintableKey(event)) {
      pendingPrintableKey = true
    }
  }

  const onCompositionStart = () => {
    composing = true
    pendingPrintableKey = false
  }

  const onCompositionEnd = () => {
    composing = false
    pendingPrintableKey = false
  }

  const shouldSkipCommit = (nativeIsComposing?: boolean) =>
    composing || nativeIsComposing === true || pendingPrintableKey

  /**
   * Call after a deferred input frame. Returns true when the DOM may be
   * committed to React (English / confirmed text). Returns false when an IME
   * composition started in the meantime.
   */
  const consumeDeferredCommit = () => {
    pendingPrintableKey = false
    return !composing
  }

  return {
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    shouldSkipCommit,
    consumeDeferredCommit,
    get isComposing() {
      return composing
    },
  }
}
