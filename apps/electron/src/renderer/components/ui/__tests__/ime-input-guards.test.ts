import { describe, expect, it } from 'bun:test'
import {
  createImeFirstKeyGate,
  isImeProcessKey,
  isUnmodifiedPrintableKey,
} from '../ime-input-guards'

describe('IME first-key guards (#84)', () => {
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

  it('defers commit until compositionstart can arrive after the first printable key', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n' })
    expect(gate.shouldSkipCommit()).toBe(true)

    gate.onCompositionStart()
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.consumeDeferredCommit()).toBe(false)
  })

  it('commits an English first letter when composition never starts', () => {
    const gate = createImeFirstKeyGate()
    gate.onKeyDown({ key: 'n' })
    expect(gate.shouldSkipCommit()).toBe(true)
    expect(gate.consumeDeferredCommit()).toBe(true)
    expect(gate.shouldSkipCommit()).toBe(false)
  })
})
