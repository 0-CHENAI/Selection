/**
 * Pure-helper coverage for the model-picker. The helpers are tiny but they
 * back both the desktop dropdown and the compact (drawer) selector — pinning
 * the behavior here so future refactors of the picker can't quietly diverge
 * the two surfaces.
 */

import { describe, test, expect } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import {
  appendMissingPickerModel,
  connectionPinnedModelIds,
  formatTokenCount,
  groupConnectionsByProvider,
  isOpenRouterConnection,
  isPickerModelSelected,
  pickerModelId,
  pickerModelMatchesQuery,
  resolvePickerModels,
  resolvePickerModelsWithLive,
  resolveVisiblePickerModels,
  stripPiPrefixForDisplay,
} from '../model-picker-helpers'

// -----------------------------------------------------------------------------
// stripPiPrefixForDisplay
// -----------------------------------------------------------------------------

describe('stripPiPrefixForDisplay', () => {
  test('strips the "pi/" prefix when present', () => {
    expect(stripPiPrefixForDisplay('pi/claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('returns input unchanged when prefix is absent', () => {
    expect(stripPiPrefixForDisplay('claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('does NOT strip "pi:" (legacy other-form prefix)', () => {
    // The prefix is "pi/" — the alternative "pi:" form is intentionally not
    // collapsed because some IDs use a colon for unrelated purposes.
    expect(stripPiPrefixForDisplay('pi:claude-opus-4-7')).toBe('pi:claude-opus-4-7')
  })

  test('only strips at the start, not mid-string', () => {
    expect(stripPiPrefixForDisplay('foo-pi/bar')).toBe('foo-pi/bar')
  })

  test('handles empty string', () => {
    expect(stripPiPrefixForDisplay('')).toBe('')
  })
})

// -----------------------------------------------------------------------------
// formatTokenCount
// -----------------------------------------------------------------------------

describe('formatTokenCount', () => {
  test('renders zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0')
  })

  test('renders < 1k literally', () => {
    expect(formatTokenCount(42)).toBe('42')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('renders 1k..<10k with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(9999)).toBe('10.0k')
  })

  test('renders ≥ 10k as whole-k', () => {
    expect(formatTokenCount(10_000)).toBe('10k')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(999_999)).toBe('1000k')
  })

  test('renders ≥ 1M with one decimal', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(12_345_678)).toBe('12.3M')
  })
})

// -----------------------------------------------------------------------------
// groupConnectionsByProvider
// -----------------------------------------------------------------------------

function conn(
  slug: string,
  providerType: LlmConnection['providerType'],
  extras: Partial<LlmConnection> = {},
): LlmConnection {
  return {
    slug,
    name: slug,
    providerType,
    authType: 'api_key',
    createdAt: 0,
    ...extras,
  }
}

describe('groupConnectionsByProvider', () => {
  test('returns empty array for empty input', () => {
    expect(groupConnectionsByProvider([])).toEqual([])
  })

  test('omits leftover Anthropic connections from the picker', () => {
    const a = conn('a', 'anthropic')
    const b = conn('b', 'anthropic')
    const piConn = conn('pi-1', 'pi')
    expect(groupConnectionsByProvider([a, b])).toEqual([])
    expect(groupConnectionsByProvider([piConn, a])).toEqual([['Selection Backend', [piConn]]])
  })

  test('preserves intra-group order', () => {
    const a = conn('first', 'pi')
    const b = conn('second', 'pi')
    const c = conn('third', 'pi')
    const result = groupConnectionsByProvider([a, b, c])
    expect(result[0][1].map(c => c.slug)).toEqual(['first', 'second', 'third'])
  })

  test('"pi_compat" with localhost baseUrl goes to "Local"', () => {
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://localhost:11434' })
    const result = groupConnectionsByProvider([local])
    expect(result).toEqual([['Local', [local]]])
  })

  test('"pi_compat" with remote baseUrl goes to "Selection Backend"', () => {
    const remote = conn('openrouter', 'pi_compat', { baseUrl: 'https://openrouter.ai/api/v1' })
    const result = groupConnectionsByProvider([remote])
    expect(result).toEqual([['Selection Backend', [remote]]])
  })

  test('drops empty groups from the output', () => {
    const a = conn('a', 'pi')
    const result = groupConnectionsByProvider([a])
    expect(result.length).toBe(1)
    expect(result[0][0]).toBe('Selection Backend')
  })

  test('full mixed input — leftover anthropic is dropped, local + remote remain', () => {
    const anth = conn('a', 'anthropic')
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://127.0.0.1:1234' })
    const remote = conn('or', 'pi_compat', { baseUrl: 'https://openrouter.ai' })
    const pi = conn('p', 'pi')
    const result = groupConnectionsByProvider([anth, local, remote, pi])
    expect(result.map(([k, conns]) => [k, conns.map(c => c.slug)])).toEqual([
      ['Local', ['ollama']],
      ['Selection Backend', ['or', 'p']],
    ])
  })
})

describe('resolvePickerModels', () => {
  test('returns empty when there is no connection', () => {
    expect(resolvePickerModels(null)).toEqual([])
    expect(resolvePickerModels(undefined)).toEqual([])
  })

  test('uses the connection catalog when present', () => {
    const models = ['Opus', 'Laufry']
    expect(resolvePickerModels(conn('order', 'pi_compat', { models }))).toEqual(models)
  })

  test('falls back to defaultModel for a compat connection with an empty catalog', () => {
    expect(resolvePickerModels(conn('order', 'pi_compat', { defaultModel: 'Opus', models: [] }))).toEqual(['Opus'])
  })

  test('does not invent Anthropic models for a compat connection', () => {
    expect(resolvePickerModels(conn('order', 'pi_compat'))).toEqual([])
  })

  test('uses the Anthropic registry when an Anthropic connection has no models', () => {
    const models = resolvePickerModels(conn('anth', 'anthropic'))
    expect(models.length).toBeGreaterThan(0)
    expect(pickerModelId(models[0]!)).toMatch(/claude|sonnet|opus|haiku/i)
  })
})

describe('resolvePickerModelsWithLive', () => {
  const live = [
    { id: 'pi/openrouter/horizon-beta', name: 'Horizon Beta', contextWindow: 128000, reasoning: true },
    { id: 'pi/openrouter/stealth', name: 'Stealth', contextWindow: 200000, reasoning: false },
  ]

  test('uses the live OpenRouter catalog when the fetch succeeded', () => {
    const models = resolvePickerModelsWithLive(
      conn('or', 'pi', { piAuthProvider: 'openrouter', models: ['pi/only-three'] }),
      live,
    )
    expect(models.map(pickerModelId)).toEqual([
      'pi/openrouter/horizon-beta',
      'pi/openrouter/stealth',
    ])
  })

  test('does not keep a stored default that is missing from the live catalog', () => {
    const models = resolvePickerModelsWithLive(
      conn('or', 'pi', {
        piAuthProvider: 'openrouter',
        defaultModel: 'pi/openrouter/legacy',
        models: ['pi/only-three'],
      }),
      live,
    )
    expect(models.map(pickerModelId)).not.toContain('pi/openrouter/legacy')
  })

  test('falls back to stored models when live catalog is empty or missing', () => {
    const stored = conn('or', 'pi', { piAuthProvider: 'openrouter', models: ['pi/only-three'] })
    expect(resolvePickerModelsWithLive(stored, null)).toEqual(['pi/only-three'])
    expect(resolvePickerModelsWithLive(stored, [])).toEqual(['pi/only-three'])
  })

  test('ignores live catalog for non-OpenRouter connections', () => {
    const models = resolvePickerModelsWithLive(
      conn('order', 'pi_compat', { models: ['Opus'] }),
      live,
    )
    expect(models).toEqual(['Opus'])
  })
})

describe('isOpenRouterConnection', () => {
  test('matches piAuthProvider only', () => {
    expect(isOpenRouterConnection(conn('or', 'pi', { piAuthProvider: 'openrouter' }))).toBe(true)
    expect(isOpenRouterConnection(conn('or', 'pi', { piAuthProvider: 'openai' }))).toBe(false)
    expect(isOpenRouterConnection(null)).toBe(false)
  })
})

describe('appendMissingPickerModel', () => {
  test('does not duplicate a matching id with a different prefix', () => {
    expect(appendMissingPickerModel(['pi/Opus'], 'Opus')).toEqual(['pi/Opus'])
  })

  test('appends when the id is absent', () => {
    expect(appendMissingPickerModel(['pi/Opus'], 'Laufry')).toEqual(['pi/Opus', 'Laufry'])
  })
})

describe('resolveVisiblePickerModels', () => {
  const catalog = [
    { id: 'pi/openrouter/gpt-5.5-pro', name: 'OpenAI: GPT-5.5 Pro', shortName: 'GPT-5.5 Pro', contextWindow: 1, reasoning: false, description: '', provider: 'pi' as const },
    { id: 'pi/openrouter/o1-pro', name: 'OpenAI: o1-pro', shortName: 'o1-pro', contextWindow: 1, reasoning: true, description: '', provider: 'pi' as const },
    { id: 'pi/openrouter/cheap', name: 'Cheap', shortName: 'Cheap', contextWindow: 1, reasoning: false, description: '', provider: 'pi' as const },
    { id: 'pi/openrouter/stealth', name: 'Stealth', shortName: 'Stealth', contextWindow: 1, reasoning: false, description: '', provider: 'pi' as const },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `pi/openrouter/extra-${i}`,
      name: `Extra ${i}`,
      shortName: `Extra ${i}`,
      contextWindow: 1,
      reasoning: false,
      description: '',
      provider: 'pi' as const,
    })),
  ]

  test('shows the full list when the catalog is small', () => {
    const small = catalog.slice(0, 3)
    const result = resolveVisiblePickerModels(small, { currentModel: 'pi/openrouter/cheap' })
    expect(result.collapsed).toBe(false)
    expect(result.visible).toEqual(small)
    expect(result.hiddenCount).toBe(0)
  })

  test('previews only the current and pinned models until the user searches', () => {
    const result = resolveVisiblePickerModels(catalog, {
      currentModel: 'pi/openrouter/cheap',
      pinnedIds: ['pi/openrouter/stealth', 'pi/openrouter/cheap'],
    })
    expect(result.collapsed).toBe(true)
    expect(result.visible.map(pickerModelId)).toEqual([
      'pi/openrouter/cheap',
      'pi/openrouter/stealth',
    ])
    expect(result.hiddenCount).toBe(catalog.length - 2)
  })

  test('search looks up matches in the full catalog', () => {
    const result = resolveVisiblePickerModels(catalog, { query: 'stealth' })
    expect(result.collapsed).toBe(false)
    expect(result.visible.map(pickerModelId)).toEqual(['pi/openrouter/stealth'])
    expect(result.matchCount).toBe(1)
  })

  test('does not offer a current model that is missing from the catalog', () => {
    const result = resolveVisiblePickerModels(catalog, {
      currentModel: 'pi/openrouter/legacy',
    })
    expect(result.visible.map(pickerModelId)).not.toContain('pi/openrouter/legacy')
  })
})

describe('connectionPinnedModelIds', () => {
  test('returns stored models and the default', () => {
    expect(connectionPinnedModelIds(conn('or', 'pi', {
      models: ['best', 'default'],
      defaultModel: 'default',
    }))).toEqual(['best', 'default'])
  })
})

describe('pickerModelMatchesQuery', () => {
  test('matches name and id', () => {
    expect(pickerModelMatchesQuery({ id: 'pi/openrouter/stealth', name: 'Stealth', shortName: 'Stealth', contextWindow: 1, description: '', provider: 'pi' }, 'steal')).toBe(true)
    expect(pickerModelMatchesQuery('pi/openrouter/stealth', 'openrouter/stealth')).toBe(true)
    expect(pickerModelMatchesQuery('pi/openrouter/stealth', 'jamba')).toBe(false)
  })
})

describe('isPickerModelSelected', () => {
  test('matches stored IDs against runtime pi/ prefixes', () => {
    expect(isPickerModelSelected('pi/Opus', 'Opus')).toBe(true)
    expect(isPickerModelSelected('Opus', 'pi/Opus')).toBe(true)
    expect(isPickerModelSelected('Opus', 'Laufry')).toBe(false)
  })
})
