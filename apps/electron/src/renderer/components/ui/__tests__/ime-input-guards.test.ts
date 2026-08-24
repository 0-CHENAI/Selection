import { describe, expect, it } from 'bun:test'
import {
  createImeFirstKeyGate,
  EMPTY_EDITOR_ZWSP,
  emptyEditorHTML,
  isEmptyEditorImeCandidate,
  isImeFirstLetter,
  isImeProcessKey,
  isUnmodifiedPrintableKey,
} from '../ime-input-guards'

describe('IME first-key guards (#84 #97 #107)', () => {
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

  it('only treats latin IME first letters as empty-editor candidates', () => {
    expect(isImeFirstLetter('n')).toBe(true)
    expect(isImeFirstLetter('Ü')).toBe(true)
    expect(isEmptyEditorImeCandidate('', 'n')).toBe(true)
    expect(isEmptyEditorImeCandidate('already', 'n')).toBe(false)
    expect(isEmptyEditorImeCandidate('', 'ni')).toBe(false)
    expect(isEmptyEditorImeCandidate('', '')).toBe(false)
    expect(isEmptyEditorImeCandidate('', '你')).toBe(false)
    expect(isEmptyEditorImeCandidate('', '@')).toBe(false)
    expect(isEmptyEditorImeCandidate('', '/')).toBe(false)
    expect(isEmptyEditorImeCandidate('', ' ')).toBe(false)
  })

  it('gives an empty editor a text-node anchor instead of a br-only shell', () => {
    expect(emptyEditorHTML()).toContain(EMPTY_EDITOR_ZWSP)
    expect(emptyEditorHTML()).toContain('<br>')
    expect(emptyEditorHTML().startsWith(EMPTY_EDITOR_ZWSP)).toBe(true)
  })

  it('keeps the first-key window open when a second letter arrives before keyup', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: '' })
    gate.onPossibleFirstInsert({ previousValue: '', insertedOrCurrent: 'n', inputType: 'insertText' })
    expect(gate.shouldSkipCommit()).toBe(true)
    gate.onPossibleFirstInsert({ previousValue: '', insertedOrCurrent: 'ni', inputType: 'insertText' })
    expect(gate.isPending).toBe(true)
    expect(gate.shouldSkipCommit()).toBe(true)
    gate.onCompositionStart()
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('defers commit until compositionstart can arrive after the first printable key', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: '' })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.isPending).toBe(true)

    gate.onCompositionStart()
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.isPending).toBe(false)
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('does not defer printable keys once the editor already has text', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: 'hello' })
    expect(gate.shouldSkipCommit()).toBe(false)
    expect(gate.isPending).toBe(false)
  })

  it('does not defer mention or slash prefixes on an empty editor', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: '@', previousValue: '' })
    gate.onPossibleFirstInsert({ previousValue: '', insertedOrCurrent: '@', inputType: 'insertText' })
    expect(gate.shouldSkipCommit()).toBe(false)
  })

  it('defers commit when Chromium inserts the first letter before keydown', () => {
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

    gate.onKeyDown({ key: 'n', previousValue: '' })
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

  it('commits an English first letter on keyup when composition never starts', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: '' })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.consumeDeferredCommit()).toBe(true)
    expect(gate.shouldSkipCommit()).toBe(false)
  })

  it('does not commit on keyup after compositionstart', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: '' })
    gate.onCompositionStart()
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('resets pending and composing when the parent value changes', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n', previousValue: '' })
    gate.onCompositionStart()
    gate.reset()
    expect(gate.isPending).toBe(false)
    expect(gate.isComposing).toBe(false)
    expect(gate.shouldSkipCommit()).toBe(false)
  })
})
