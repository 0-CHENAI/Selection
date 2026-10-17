import { describe, expect, it } from 'bun:test'
import {
  constrainThinkingLevel,
  fallbackThinkingCapability,
  levelsFromThinkingLevelMap,
  modelThinkingCapability,
  modelThinkingLevels,
  resolveSessionThinkingLevel,
  thinkingLevelMapForLevels,
} from '../thinking-capabilities.ts'
import { THINKING_LEVEL_IDS } from '../thinking-levels.ts'
import { buildCustomEndpointModelDef } from '../../../../pi-agent-server/src/custom-endpoint-models.ts'

describe('thinking capabilities', () => {
  it('reads a Pi thinkingLevelMap and collapses duplicate Anthropic wires', () => {
    expect(levelsFromThinkingLevelMap(true, {
      off: null,
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    })).toEqual(['minimal', 'low', 'medium', 'high'])

    expect(levelsFromThinkingLevelMap(true, {
      xhigh: 'xhigh',
      max: 'max',
    }, 'anthropic-messages')).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

    expect(levelsFromThinkingLevelMap(true, {
      off: null,
      xhigh: 'xhigh',
      max: 'max',
    }, 'anthropic-messages')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])

    expect(levelsFromThinkingLevelMap(false, null)).toEqual([])
  })

  it('keeps provider catalogs distinct for the same model family', () => {
    const apiKeyGpt5 = modelThinkingCapability({
      id: 'gpt-5',
      reasoning: true,
      api: 'openai-responses',
      thinkingLevelMap: {
        off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null,
      },
    })
    expect(apiKeyGpt5.levels).toEqual(['minimal', 'low', 'medium', 'high'])

    const codex = modelThinkingCapability({
      id: 'gpt-6-luna',
      reasoning: true,
      api: 'openai-codex-responses',
      thinkingLevelMap: {
        off: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
      },
    })
    expect(codex.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(codex.levels).not.toContain('minimal')
  })

  it('uses the fallback table when the model list has no map', () => {
    expect(fallbackThinkingCapability('claude-opus-4-8')?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(fallbackThinkingCapability('pi/claude-fable-5')?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(fallbackThinkingCapability('us.anthropic.claude-haiku-4-5-20251001-v1:0')?.levels).toEqual(['off', 'low', 'medium', 'high'])
    expect(fallbackThinkingCapability('gemini-2.5-flash')?.levels).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(fallbackThinkingCapability('gemini-3-flash-preview')?.levels).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(fallbackThinkingCapability('deepseek-v4-pro')?.levels).toEqual(['off', 'high', 'max'])
    expect(fallbackThinkingCapability('deepseek-flash')?.levels).toEqual(['off', 'low', 'high', 'max'])
    expect(fallbackThinkingCapability('kimi-k3')?.levels).toEqual(['low', 'high', 'max'])
    expect(fallbackThinkingCapability('kimi-k2.6')).toMatchObject({ binary: true, levels: ['off', 'high'] })
    expect(fallbackThinkingCapability('kimi-k2.7')?.mode).toBe('always-on')
    expect(fallbackThinkingCapability('gpt-4o')?.mode).toBe('unsupported')
    expect(fallbackThinkingCapability('gpt-5')?.levels).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(fallbackThinkingCapability('gpt-5.4')?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    expect(fallbackThinkingCapability('gpt-6-luna')?.levels).toContain('max')
    expect(modelThinkingLevels({ id: 'gpt-4o' })).toEqual([])
    expect(modelThinkingLevels({ id: 'claude-sonnet-4-6' }).map(level => level.id)).toEqual(['off', 'low', 'medium', 'high', 'max'])
    // A live catalog row that reasons without a map keeps Pi's default stops, including minimal.
    expect(modelThinkingCapability({ id: 'vendor-reasoner', reasoning: true }).levels)
      .toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(modelThinkingCapability({ id: 'claude-fable-5', reasoning: true, thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' }, api: 'anthropic-messages' }).levels)
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('prefers an explicit list, including an explicit empty list', () => {
    expect(modelThinkingCapability({
      id: 'gpt-5',
      supportedThinkingLevels: ['low', 'high'],
    }).levels).toEqual(['low', 'high'])
    expect(modelThinkingCapability({ id: 'gpt-5', supportedThinkingLevels: [] }).mode).toBe('unsupported')
    expect(modelThinkingCapability({ thinkingMode: 'always-on', supportedThinkingLevels: ['high'] }).mode).toBe('always-on')
  })

  it('maps Copilot effort names and keeps off available', () => {
    expect(modelThinkingCapability({
      id: 'gpt-5.4',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    }).levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
  })

  it('moves an out-of-range stop to the nearest legal one', () => {
    expect(constrainThinkingLevel('medium', ['low', 'high'])).toBe('low')
    expect(constrainThinkingLevel('xhigh', ['off', 'low', 'medium', 'high'])).toBe('high')
    expect(constrainThinkingLevel('max', ['low', 'high'])).toBe('high')
    expect(constrainThinkingLevel('off', ['low', 'medium', 'high'])).toBe('low')
    expect(constrainThinkingLevel('high', [])).toBe('off')
    expect(constrainThinkingLevel('high', undefined)).toBe('high')
    expect(resolveSessionThinkingLevel({ id: 'kimi-k2.7' }, 'off')).toBe('low')
    expect(resolveSessionThinkingLevel({ id: 'kimi-k2.6' }, 'xhigh')).toBe('high')
    expect(resolveSessionThinkingLevel({ id: 'gpt-4o' }, 'medium')).toBe('off')
  })

  it('registers ORDER and custom endpoints with only the legal wire values', () => {
    const deepseek = buildCustomEndpointModelDef('deepseek-v4-pro')
    expect(deepseek.reasoning).toBe(true)
    expect(deepseek.thinkingLevelMap).toMatchObject({ minimal: null, low: null, medium: null, high: 'high', max: 'max' })
    expect(deepseek.thinkingLevelMap?.off).toBeUndefined()

    const plain = buildCustomEndpointModelDef('gpt-4o')
    expect(plain.reasoning).toBe(false)

    const declared = thinkingLevelMapForLevels(['minimal', 'high'])
    expect(declared.minimal).toBe('minimal')
    expect(declared.low).toBeNull()
    expect(declared.medium).toBeNull()

    const fable = buildCustomEndpointModelDef('claude-fable-5', undefined, undefined, 'anthropic-messages')
    expect(fable.reasoning).toBe(true)
    expect(fable.thinkingLevelMap?.off).toBeNull()
    expect(fable.thinkingLevelMap?.xhigh).toBe('xhigh')
    expect(fable.thinkingLevelMap?.low).toBe('low')
  })

  it('keeps every canonical stop in order', () => {
    expect(THINKING_LEVEL_IDS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})
