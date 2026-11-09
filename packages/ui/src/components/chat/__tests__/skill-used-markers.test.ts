import { describe, expect, it } from 'bun:test'
import { parseSkillUsedMarkers } from '../skill-used-markers.ts'

describe('parseSkillUsedMarkers', () => {
  it('extracts a leading marker and removes it from visible content', () => {
    expect(parseSkillUsedMarkers(
      '[skill-used:customer-reply-polisher]\n\nRewritten reply',
    )).toEqual({
      content: 'Rewritten reply',
      skills: ['customer-reply-polisher'],
      hasPendingMarker: false,
    })
  })

  it('extracts multiple leading markers and removes duplicates', () => {
    expect(parseSkillUsedMarkers(
      '  [skill-used:first]\n[skill-used:second]\n[skill-used:first]\nResult',
    )).toEqual({
      content: 'Result',
      skills: ['first', 'second'],
      hasPendingMarker: false,
    })
  })

  it('preserves marker examples outside the response prefix', () => {
    const content = 'Use `[skill-used:example]` when testing.'
    expect(parseSkillUsedMarkers(content)).toEqual({
      content,
      skills: [],
      hasPendingMarker: false,
    })
  })

  it('preserves malformed markers after streaming completes', () => {
    const content = '[skill-used:]\nResult'
    expect(parseSkillUsedMarkers(content)).toEqual({
      content,
      skills: [],
      hasPendingMarker: false,
    })
  })

  it('hides a partial leading marker while streaming', () => {
    expect(parseSkillUsedMarkers('[skill-used:customer-reply', true)).toEqual({
      content: '',
      skills: [],
      hasPendingMarker: true,
    })
  })

  it('keeps extracted skills while a following marker is still streaming', () => {
    expect(parseSkillUsedMarkers(
      '[skill-used:first]\n[skill-us',
      true,
    )).toEqual({
      content: '',
      skills: ['first'],
      hasPendingMarker: true,
    })
  })
})
