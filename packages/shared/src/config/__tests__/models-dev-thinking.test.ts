import { describe, expect, it } from 'bun:test'
import {
  capabilityFromReasoningOptions,
  clearModelsDevThinkingIndex,
  installModelsDevThinkingIndex,
  lookupModelsDevThinking,
  parseModelsDevCatalog,
} from '../models-dev-thinking.ts'
import { modelThinkingCapability } from '../../agent/thinking-capabilities.ts'

describe('models.dev thinking options', () => {
  it('uses named efforts and does not turn a Kimi toggle into Off', () => {
    expect(capabilityFromReasoningOptions(true, [
      { type: 'toggle' },
      { type: 'effort', values: ['low', 'high', 'max'] },
    ], 'kimi-code-plan-global', 'k3')?.levels).toEqual(['low', 'high', 'max'])

    expect(capabilityFromReasoningOptions(true, [
      { type: 'toggle' },
      { type: 'effort', values: ['low', 'high', 'max'] },
    ], 'deepseek', 'deepseek-v4-pro')?.levels).toEqual(['off', 'low', 'high', 'max'])
  })

  it('leaves budget-only models unresolved so the static table can name stops', () => {
    expect(capabilityFromReasoningOptions(true, [
      { type: 'toggle' },
      { type: 'budget_tokens', min: 0, max: 24576 },
    ], 'google', 'gemini-2.5-flash')).toBeUndefined()
  })

  it('treats an empty option list on a reasoning model as always on', () => {
    expect(capabilityFromReasoningOptions(true, [], 'kimi-code-plan-global', 'kimi-for-coding-highspeed')?.mode).toBe('always-on')
  })

  it('resolves Kimi Code ids through the provider alias', () => {
    const entries = parseModelsDevCatalog({
      'kimi-code-plan-global': {
        models: {
          'k3-256k': { id: 'k3-256k', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
        },
      },
    })
    installModelsDevThinkingIndex(entries)
    try {
      expect(lookupModelsDevThinking('kimi-coding', 'pi/k3-256k')?.levels).toEqual(['low', 'high', 'max'])
      expect(modelThinkingCapability({
        id: 'k3-256k',
        provider: 'kimi-coding',
        supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'max'],
      }).source).toBe('models-dev')
    } finally {
      clearModelsDevThinkingIndex()
    }
  })
})
