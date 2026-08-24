/**
 * CJK IME first-key guards (#25, #84, #97, #107).
 *
 * macOS Pinyin on an empty contenteditable often InsertTexts the first latin
 * letter instead of SetComposition when the editor has no text node (only
 * `<br>`). Deferring React commit cannot start IME after that insert. Keep a
 * ZWSP anchor so Chromium can attach composition, do not rewrite the
 * contenteditable on the first key, and commit English on keyup if IME
 * never starts — not on a timer.
 */

/** Zero-width text node so an empty editor is not `<br>`-only. */
export const EMPTY_EDITOR_ZWSP = '\u200B'

export function emptyEditorHTML(): string {
  return `${EMPTY_EDITOR_ZWSP}<br>`
}

/** Contenteditable caret `<br>` in an otherwise empty editor is not user text. */
export function isPlaceholderCaretBr(
  isTopLevel: boolean,
  textSoFar: string,
  hasNextMeaningfulSibling: boolean,
): boolean {
  return isTopLevel && textSoFar.length === 0 && !hasNextMeaningfulSibling
}

/** Empty editor, or a lone newline left by the contenteditable caret `<br>`. */
export function isEmptyComposerValue(value: string): boolean {
  const text = value.replace(/\u200B/g, '')
  return text === '' || text === '\n'
}

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

/** Pinyin / latin IME first keys. Mentions, slash commands, and CJK text commit immediately. */
export function isImeFirstLetter(key: string): boolean {
  return /^[a-zA-ZüÜ]$/.test(key)
}

export function isEmptyEditorImeCandidate(previousValue: string, insertedOrCurrent: string): boolean {
  return isEmptyComposerValue(previousValue) && isImeFirstLetter(insertedOrCurrent)
}

export function createImeFirstKeyGate() {
  let composing = false
  let pendingPrintableKey = false

  const markPending = () => {
    if (!composing) pendingPrintableKey = true
  }

  const reset = () => {
    composing = false
    pendingPrintableKey = false
  }

  const onKeyDown = (event: {
    key?: string
    keyCode?: number
    which?: number
    isComposing?: boolean
    previousValue?: string
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
  }) => {
    if (event.isComposing || isImeProcessKey(event)) {
      composing = true
      pendingPrintableKey = false
      return
    }
    if (isEmptyEditorImeCandidate(event.previousValue ?? '', event.key ?? '')) {
      markPending()
    }
  }

  /**
   * Chromium may fire beforeinput/input with a single latin letter while the
   * editor is still empty, before keydown or compositionstart.
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
   * English first letters commit on keyup (or blur) if composition never
   * started. Returns false when an IME session is active.
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
    reset,
    get isComposing() {
      return composing
    },
    get isPending() {
      return pendingPrintableKey
    },
  }
}
