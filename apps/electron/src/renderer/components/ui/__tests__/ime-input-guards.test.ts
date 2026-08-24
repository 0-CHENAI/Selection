import { describe, expect, it } from 'bun:test'
import {
  createImeFirstKeyGate,
  IME_FIRST_KEY_COMMIT_DELAY_MS,
  isEmptyEditorImeCandidate,
  isImeProcessKey,
  isUnmodifiedPrintableKey,
} from '../ime-input-guards'

describe('IME first-key guards (#84 #97)', () => {
  it('treats keyCode 229 as an IME process key', () => {
    expect(isImeProcessKey({ keyCode: 229 })).toBe(true)
    expect(isImeProcessKey({ which: 229 })).toBe(true)
    expect(isImeProcessKey({ keyCode: 78 })).toBe(false)
  })

  it('treats unmodified latin letters as printable IME candidates', () => {
    expect(isUnmodifiedPrintableKey({ key: 'n' })).toBe(true)
    expect(isUnmodifiedPrintableKey({ key: 'n', metaKey: true })).toBe(false)
    expect(isUnmodifiedPrintableKey({ key: 'Enter' })).toBe(false)
  })

  it('treats a single letter in an empty editor as an IME candidate', () => {
    expect(isEmptyEditorImeCandidate('', 'n')).toBe(true)
    expect(isEmptyEditorImeCandidate('', '你')).toBe(true)
    expect(isEmptyEditorImeCandidate('already', 'n')).toBe(false)
    expect(isEmptyEditorImeCandidate('', 'ni')).toBe(false)
    expect(isEmptyEditorImeCandidate('', '')).toBe(false)
  })

  it('waits longer than one animation frame before committing English', () => {
    expect(IME_FIRST_KEY_COMMIT_DELAY_MS).toBeGreaterThan(16)
  })

  it('defers commit until compositionstart can arrive after the first printable key', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n' })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.isPending).toBe(true)

    gate.onCompositionStart()
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.isPending).toBe(false)
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('defers commit when Chromium inserts the first letter before keydown (#97)', () => {
    const gate = createImeFirstKeyGate()
    gate.onPossibleFirstInsert({
      previousValue: '',
      insertedOrCurrent: 'n',
      inputType: 'insertText',
    })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.isPending).toBe(true)

    gate.onCompositionStart()
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('defers commit when input fires on an empty editor without a keydown', () => {
    const gate = createImeFirstKeyGate()
    gate.onPossibleFirstInsert({
      previousValue: '',
      insertedOrCurrent: 'n',
    })
    expect(gate.shouldSkipCommit()).toBe(true)

    gate.onKeyDown({ key: 'n' })
    expect(gate.shouldSkipCommit()).toBe(true)
    gate.onCompositionStart()
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('does not treat later inserts as first-key IME candidates', () => {
    const gate = createImeFirstKeyGate()
    gate.onPossibleFirstInsert({
      previousValue: 'hello',
      insertedOrCurrent: 'n',
      inputType: 'insertText',
    })
    expect(gate.shouldSkipCommit()).toBe(false)
    expect(gate.consumeDeferredCommit()).toBe(true)
  })

  it('ignores non-insert beforeinput on an empty editor', () => {
    const gate = createImeFirstKeyGate()
    gate.onPossibleFirstInsert({
      previousValue: '',
      insertedOrCurrent: 'n',
      inputType: 'deleteContentBackward',
    })
    expect(gate.shouldSkipCommit()).toBe(false)
  })

  it('commits an English first letter when composition never starts', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n' })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.consumeDeferredCommit()).toBe(true)
    expect(gate.shouldSkipCommit()).toBe(false)
  })
})
