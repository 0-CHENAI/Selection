import { describe, expect, it } from 'bun:test'
import { isSourcesPanelShown } from '../sources-panel'

describe('sources panel visibility helper', () => {
  it('can hide an open column without forgetting that it was open', () => {
    expect(isSourcesPanelShown(true, false)).toBe(true)
    expect(isSourcesPanelShown(true, true)).toBe(false)
    expect(isSourcesPanelShown(false, false)).toBe(false)
    expect(isSourcesPanelShown(false, true)).toBe(false)
  })
})
