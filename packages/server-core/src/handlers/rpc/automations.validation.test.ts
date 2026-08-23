import { describe, expect, test } from 'bun:test'
import { VALID_EVENTS } from '@craft-agent/shared/automations'
import { findStrictAutomationRegistrationErrors } from './automations'

describe('strict automation registration validation', () => {
  test('rejects unknown events and action types instead of silently dropping them', () => {
    const errors = findStrictAutomationRegistrationErrors({
      automations: {
        MadeUpEvent: [{ actions: [{ type: 'prompt' }] }],
        SessionStart: [{ actions: [{ type: 'made-up-action' }] }],
      },
    }, VALID_EVENTS)

    expect(errors).toContain('Unknown automation event: MadeUpEvent')
    expect(errors).toContain('automations.SessionStart[0]: Unknown action type: made-up-action')
  })

  test('accepts every supported action type on a known event', () => {
    expect(findStrictAutomationRegistrationErrors({
      automations: {
        SessionStart: [{ actions: [
          { type: 'prompt' },
          { type: 'webhook' },
          { type: 'decision' },
        ] }],
      },
    }, VALID_EVENTS)).toEqual([])
  })
})
