import { describe, expect, test } from 'bun:test'
import { VALID_EVENTS } from '@craft-agent/shared/automations'
import { findStrictAutomationRegistrationErrors } from './automations'

describe('strict automation registration validation', () => {
  test('rejects retired runtime events and tool decision actions', () => {
    expect(findStrictAutomationRegistrationErrors({ automations: {
      PreToolUse: [{ actions: [{ type: 'prompt' }] }],
      LabelAdd: [{ actions: [{ type: 'decision' }] }],
    } }, VALID_EVENTS)).toEqual([
      'Unknown automation event: PreToolUse',
      'automations.LabelAdd[0]: Unknown action type: decision',
    ])
  })
  test('rejects unknown events and action types instead of silently dropping them', () => {
    const errors = findStrictAutomationRegistrationErrors({
      automations: {
        MadeUpEvent: [{ actions: [{ type: 'prompt' }] }],
        LabelAdd: [{ actions: [{ type: 'made-up-action' }] }],
      },
    }, VALID_EVENTS)

    expect(errors).toContain('Unknown automation event: MadeUpEvent')
    expect(errors).toContain('automations.LabelAdd[0]: Unknown action type: made-up-action')
  })

  test('accepts every supported action type on a known event', () => {
    expect(findStrictAutomationRegistrationErrors({
      automations: {
        LabelAdd: [{ actions: [
          { type: 'prompt' },
          { type: 'webhook' },
        ] }],
      },
    }, VALID_EVENTS)).toEqual([])
  })
})
