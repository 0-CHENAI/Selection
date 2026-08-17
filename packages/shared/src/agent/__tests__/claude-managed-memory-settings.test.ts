import { describe, expect, it } from 'bun:test'
import {
  buildClaudeSessionEnvOverrides,
  buildClaudeSubprocessEnv,
  CRAFT_MANAGED_ANTHROPIC_AUTH,
  SELECTION_MANAGED_SETTINGS,
} from '../options.ts'

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

  it('keeps configured Claude credentials isolated across concurrent sessions', () => {
    const previous = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    }
    process.env.ANTHROPIC_API_KEY = 'GLOBAL_CANARY_KEY'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'GLOBAL_CANARY_OAUTH'
    process.env.ANTHROPIC_BASE_URL = 'https://global.invalid'

    try {
      const overridesA = buildClaudeSessionEnvOverrides({}, {
        ANTHROPIC_API_KEY: 'SESSION_A_KEY',
        ANTHROPIC_BASE_URL: 'https://session-a.invalid',
      })
      const overridesB = buildClaudeSessionEnvOverrides({}, {
        CLAUDE_CODE_OAUTH_TOKEN: 'SESSION_B_OAUTH',
      })
      const envA = buildClaudeSubprocessEnv(overridesA)
      const envB = buildClaudeSubprocessEnv(overridesB)

      expect(envA.ANTHROPIC_API_KEY).toBe('SESSION_A_KEY')
      expect(envA.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(envA.ANTHROPIC_BASE_URL).toBe('https://session-a.invalid')
      expect(envB.ANTHROPIC_API_KEY).toBeUndefined()
      expect(envB.CLAUDE_CODE_OAUTH_TOKEN).toBe('SESSION_B_OAUTH')
      expect(envB.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(envA[CRAFT_MANAGED_ANTHROPIC_AUTH]).toBeUndefined()
      expect(envB[CRAFT_MANAGED_ANTHROPIC_AUTH]).toBeUndefined()

      // Building session envs must not mutate the host process baseline.
      expect(process.env.ANTHROPIC_API_KEY).toBe('GLOBAL_CANARY_KEY')
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('GLOBAL_CANARY_OAUTH')
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://global.invalid')
    } finally {
      for (const [key, value] of Object.entries({
        ANTHROPIC_API_KEY: previous.apiKey,
        CLAUDE_CODE_OAUTH_TOKEN: previous.oauthToken,
        ANTHROPIC_BASE_URL: previous.baseUrl,
      })) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('preserves explicit environment-auth inheritance without a managed marker', () => {
    const previous = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'ENVIRONMENT_AUTH_KEY'
    try {
      const overrides = buildClaudeSessionEnvOverrides(
        { CRAFT_SESSION_DIR: '/sessions/environment-auth' },
        { ANTHROPIC_BASE_URL: 'https://environment-auth.invalid' },
        { inheritProcessAuth: true },
      )
      const env = buildClaudeSubprocessEnv(overrides)

      expect(overrides.CRAFT_SESSION_DIR).toBe('/sessions/environment-auth')
      expect(overrides[CRAFT_MANAGED_ANTHROPIC_AUTH]).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBe('ENVIRONMENT_AUTH_KEY')
      expect(env.ANTHROPIC_BASE_URL).toBe('https://environment-auth.invalid')
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previous
    }
  })

  it('treats direct credential overrides as isolated even without the internal marker', () => {
    const previous = {
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'GLOBAL_OAUTH_CANARY'
    process.env.ANTHROPIC_BASE_URL = 'https://global.invalid'
    try {
      const env = buildClaudeSubprocessEnv({ ANTHROPIC_API_KEY: 'DIRECT_TEST_KEY' })

      expect(env.ANTHROPIC_API_KEY).toBe('DIRECT_TEST_KEY')
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    } finally {
      if (previous.oauthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous.oauthToken
      if (previous.baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
      else process.env.ANTHROPIC_BASE_URL = previous.baseUrl
    }
  })
})
