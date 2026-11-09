import { describe, expect, it } from 'bun:test'
import { shouldShowNewSessionBrand } from '../NewSessionBrand'

const emptyOrdinarySession = {
  compactMode: false,
  hideComposer: false,
  messagesLoading: false,
  messagesLoadError: null,
  messageCount: 0,
  sessionBusy: false,
}

describe('new session brand visibility', () => {
  it('shows only for a ready, idle ordinary session with no messages', () => {
    expect(shouldShowNewSessionBrand(emptyOrdinarySession)).toBe(true)
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, messageCount: 1 })).toBe(false)
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, sessionBusy: true })).toBe(false)
  })

  it('does not replace compact, loading, failed, or composer-free states', () => {
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, compactMode: true })).toBe(false)
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, messagesLoading: true })).toBe(false)
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, messagesLoadError: 'failed' })).toBe(false)
    expect(shouldShowNewSessionBrand({ ...emptyOrdinarySession, hideComposer: true })).toBe(false)
  })
})
