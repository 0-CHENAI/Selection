import { describe, expect, it } from 'bun:test'
import { validateResourceBundle } from '../resource-bundle'

describe('legacy automation resource migration', () => {
  it('accepts a retired topic matcher field so old bundles still load', () => {
    const bundle = {
      version: 1,
      exportedAt: Date.now(),
      resources: {
        automations: [{
          id: 'legacy1',
          event: 'UserPromptSubmit',
          matcher: {
            id: 'legacy1',
            telegramTopic: 'Daily digest',
            actions: [{ type: 'prompt', prompt: 'Summarize' }],
          },
        }],
      },
    }

    expect(validateResourceBundle(bundle)).toEqual({ valid: true, errors: [] })
  })
})
