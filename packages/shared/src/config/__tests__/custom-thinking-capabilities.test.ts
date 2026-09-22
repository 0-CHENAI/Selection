import { expect, it } from 'bun:test'
import { toCustomEndpointModelPayload } from '../model-image-support'
import { constrainThinkingLevel, modelThinkingLevels } from '../../agent/thinking-levels'
import { buildCustomEndpointModelDef, normalizeCustomEndpointModelEntry } from '../../../../pi-agent-server/src/custom-endpoint-models'

it('preserves editable context and reasoning capabilities from settings through SDK registration', () => {
  const stored = { id: 'custom', supportsImages: false,
    contextWindow: 123456, maxTokens: 8192, supportedThinkingLevels: ['low', 'high'] as Array<'low' | 'high'> }
  const payload = toCustomEndpointModelPayload(stored)
  const entry = normalizeCustomEndpointModelEntry(payload)
  expect(entry.supportedThinkingLevels).toEqual(['low', 'high'])
  expect(buildCustomEndpointModelDef(entry.id, undefined, entry)).toMatchObject({ contextWindow: 123456, reasoning: true })
  expect(modelThinkingLevels(stored).map(level => level.id)).toEqual(['low', 'high'])
  expect(constrainThinkingLevel('medium', entry.supportedThinkingLevels)).toBe('low')
  expect(constrainThinkingLevel('high', entry.supportedThinkingLevels)).toBe('high')
})

it('distinguishes explicit no reasoning from legacy/default capabilities', () => {
  const payload = toCustomEndpointModelPayload({ id: 'custom', supportedThinkingLevels: [] })
  const entry = normalizeCustomEndpointModelEntry(payload)
  expect(entry.supportedThinkingLevels).toEqual([])
  expect(buildCustomEndpointModelDef(entry.id, undefined, entry).reasoning).toBe(false)
  expect(modelThinkingLevels(entry)).toEqual([])
  expect(constrainThinkingLevel('high', [])).toBe('off')
  expect(constrainThinkingLevel('high', undefined)).toBe('high')
})


it('declares custom high-end levels to the SDK instead of silently clamping them', () => {
  const model = buildCustomEndpointModelDef('custom', undefined, { supportedThinkingLevels: ['high', 'xhigh', 'max'] })
  expect(model.thinkingLevelMap).toMatchObject({ low: null, medium: null, minimal: null, high: 'high', xhigh: 'xhigh', max: 'max' })
})
