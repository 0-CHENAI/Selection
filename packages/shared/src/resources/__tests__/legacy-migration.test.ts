import { describe, expect, it } from 'bun:test'
import { validateResourceBundle } from '../resource-bundle'

describe('legacy automation resource migration', () => {
  it('rejects retired runtime events rather than restoring them from a bundle', () => {
    const result = validateResourceBundle({ version: 1, exportedAt: Date.now(), resources: {
      automations: [{ id: 'retired', event: 'Stop', matcher: { actions: [{ type: 'prompt', prompt: 'Review' }] } }],
    } })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('Stop')
  })
  it('accepts a retired topic matcher field so old bundles still load', () => {
    const bundle = {
      version: 1,
      exportedAt: Date.now(),
      resources: {
        automations: [{
          id: 'legacy1',
          event: 'SessionStatusChange',
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
