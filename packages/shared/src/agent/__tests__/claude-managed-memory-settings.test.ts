import { describe, expect, it } from 'bun:test'
import { buildClaudeSubprocessEnv, SELECTION_MANAGED_SETTINGS } from '../options.ts'

describe('Claude SDK managed memory settings', () => {
  it('always disables SDK auto-memory and auto-dream', () => {
    expect(SELECTION_MANAGED_SETTINGS).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
    })
  })

  it('prefers the per-session directory over a concurrent global value', () => {
    const previous = process.env.CRAFT_SESSION_DIR
    process.env.CRAFT_SESSION_DIR = '/sessions/other-session'
    try {
      const env = buildClaudeSubprocessEnv({
        CRAFT_SESSION_DIR: '/sessions/current-session',
      })
      expect(env.CRAFT_SESSION_DIR).toBe('/sessions/current-session')
    } finally {
      if (previous === undefined) {
        delete process.env.CRAFT_SESSION_DIR
      } else {
        process.env.CRAFT_SESSION_DIR = previous
      }
    }
  })
})
