import { describe, expect, it } from 'bun:test'
import type { LlmConnectionWithStatus } from '@config/llm-connections'
import {
  buildModelCatalog,
  catalogDefaultModel,
  catalogProviderKey,
  modelChipProvider,
} from '../kanban-models'

const order: LlmConnectionWithStatus = {
  slug: 'order',
  name: 'ORDER',
  providerType: 'pi_compat',
  piAuthProvider: 'anthropic',
  baseUrl: 'https://order.ai.jxepdi.top/v1',
  isAuthenticated: true,
  models: ['Opus', 'Laufry'],
} as LlmConnectionWithStatus

describe('modelChipProvider', () => {
  it('does not brand ORDER aliases or leftover Claude ids as Anthropic', () => {
    expect(modelChipProvider('Laufry')).toBeNull()
    expect(modelChipProvider('Opus')).toBeNull()
    expect(modelChipProvider('claude-opus-4-8')).toBeNull()
  })
})

describe('catalogProviderKey', () => {
  it('keeps ORDER as order even when piAuthProvider is leftover anthropic', () => {
    expect(catalogProviderKey(order)).toBe('order')
  })
})

describe('catalogDefaultModel', () => {
  it('uses the first served model and ignores a preferred id that is not in the catalog', () => {
    const groups = [{ provider: 'order', label: 'ORDER', models: [{ id: 'Opus', name: 'Opus' }, { id: 'Laufry', name: 'Laufry' }] }]
    expect(catalogDefaultModel(groups, 'claude-opus-4-8')).toBe('Opus')
    expect(catalogDefaultModel(groups, 'Laufry')).toBe('Laufry')
  })
})

describe('buildModelCatalog', () => {
  it('lists ORDER aliases without injecting claude-opus-4-8', () => {
    const { groups, modelToConnection } = buildModelCatalog([order])
    expect(groups).toEqual([
      { provider: 'order', label: 'ORDER', models: [{ id: 'Opus', name: 'Opus' }, { id: 'Laufry', name: 'Laufry' }] },
    ])
    expect(modelToConnection.get('Opus')).toBe('order')
    expect([...modelToConnection.keys()]).not.toContain('claude-opus-4-8')
  })
})
