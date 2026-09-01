import { describe, expect, it } from 'bun:test'
import { documentOverlayErrorLabel } from './document-overlay-error-label'

describe('documentOverlayErrorLabel', () => {
  it('keeps Write Failed for write documents', () => {
    expect(documentOverlayErrorLabel(undefined, 'Write')).toBe('Write Failed')
    expect(documentOverlayErrorLabel('Write Failed', 'call_llm')).toBe('Write Failed')
  })

  it('does not label spawn or other tools as Write Failed', () => {
    expect(documentOverlayErrorLabel(undefined, 'spawn_session')).toBe('Failed')
    expect(documentOverlayErrorLabel(undefined, 'Spawn Kimi K3 worker')).toBe('Failed')
    expect(documentOverlayErrorLabel(undefined, undefined)).toBe('Failed')
  })
})
