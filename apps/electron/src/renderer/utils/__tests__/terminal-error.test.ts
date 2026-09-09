import { describe, expect, it } from 'bun:test'
import { isTerminalResponseError } from '../terminal-error'
import en from '../../../../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../../../../packages/shared/src/i18n/locales/zh-Hans.json'

describe('terminal error presentation', () => {
  it.each(['provider_timeout', 'no_response', 'tool_only_response', 'context_limit', 'stream_interrupted', 'agent_process_exited'] as const)('localizes %s and disables prompt replay', code => {
    expect(isTerminalResponseError(code)).toBe(true)
    for (const suffix of ['title', 'message']) {
      const key = `chat.terminal.${code}.${suffix}`
      expect((en as Record<string, string>)[key]).toBeTruthy()
      expect((zh as Record<string, string>)[key]).toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it('leaves unrelated error recovery intact', () => {
    expect(isTerminalResponseError('invalid_api_key')).toBe(false)
    expect(isTerminalResponseError(undefined)).toBe(false)
  })
})
