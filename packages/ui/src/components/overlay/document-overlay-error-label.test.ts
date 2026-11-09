import { describe, expect, it } from 'bun:test'
import { documentOverlayErrorLabel, overlayBodyDuplicatesError } from './document-overlay-error-label'

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

  it('hides the overlay body when it repeats the error banner', () => {
    const error = 'Unable to create Swarm workers: missing structured parallel contract. Pass qualification on spawn_session with tracks (at least two independent tracks), parallelBenefit, and finalAggregation. Writing a contract phrase into the name or prompt does not count.'
    expect(overlayBodyDuplicatesError(error, error)).toBe(true)
    expect(overlayBodyDuplicatesError(`  ${error}  `, error)).toBe(true)
    expect(overlayBodyDuplicatesError('', error)).toBe(true)
    expect(overlayBodyDuplicatesError('worker output', error)).toBe(false)
    expect(overlayBodyDuplicatesError(error, undefined)).toBe(false)
  })
})
