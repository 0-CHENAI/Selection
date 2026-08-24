/**
 * CJK IME first-key guards (#84, #97).
 *
 * Chromium can insert the first latin letter on an empty contenteditable
 * before `keydown` and before `compositionstart`. Committing that letter
 * into React state (or flipping placeholder classes) rewrites the DOM and
 * prevents composition. Defer the commit until we know the key was not
 * starting an IME session.
 */

/** Wait long enough for macOS Pinyin to emit compositionstart after the first insert. */
export const IME_FIRST_KEY_COMMIT_DELAY_MS = 80

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

export function isEmptyEditorImeCandidate(previousValue: string, insertedOrCurrent: string): boolean {
  return previousValue.length === 0
    && isUnmodifiedPrintableKey({ key: insertedOrCurrent })
}

export function createImeFirstKeyGate() {
  let composing = false
  let pendingPrintableKey = false

  const markPending = () => {
    if (!composing) pendingPrintableKey = true
  }

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
      markPending()
    }
  }

  /**
   * Chromium may fire beforeinput/input with a single latin letter while the
   * editor is still empty, before keydown or compositionstart (#97).
   */
  const onPossibleFirstInsert = (event: {
    nativeIsComposing?: boolean
    previousValue?: string
    insertedOrCurrent?: string
    inputType?: string
  }) => {
    if (event.nativeIsComposing) {
      composing = true
      pendingPrintableKey = false
      return
    }
    if (composing) return
    if (
      event.inputType
      && event.inputType !== 'insertText'
      && event.inputType !== 'insertCompositionText'
    ) {
      return
    }
    if (isEmptyEditorImeCandidate(event.previousValue ?? '', event.insertedOrCurrent ?? '')) {
      markPending()
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
   * Call after the first-key delay. Returns true when the DOM may be
   * committed to React (English / confirmed text). Returns false when an IME
   * composition started in the meantime.
   */
  const consumeDeferredCommit = () => {
    pendingPrintableKey = false
    return !composing
  }

  return {
    onKeyDown,
    onPossibleFirstInsert,
    onCompositionStart,
    onCompositionEnd,
    shouldSkipCommit,
    consumeDeferredCommit,
    get isComposing() {
      return composing
    },
    get isPending() {
      return pendingPrintableKey
    },
  }
}
