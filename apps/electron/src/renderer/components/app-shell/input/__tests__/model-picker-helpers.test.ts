/**
 * Pure-helper coverage for the model-picker. The helpers are tiny but they
 * back both the desktop dropdown and the compact (drawer) selector — pinning
 * the behavior here so future refactors of the picker can't quietly diverge
 * the two surfaces.
 */

import { describe, test, expect } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import {
  formatTokenCount,
  groupConnectionsByProvider,
  isPickerModelSelected,
  pickerModelId,
  resolvePickerModels,
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

describe('isPickerModelSelected', () => {
  test('matches stored IDs against runtime pi/ prefixes', () => {
    expect(isPickerModelSelected('pi/Opus', 'Opus')).toBe(true)
    expect(isPickerModelSelected('Opus', 'pi/Opus')).toBe(true)
    expect(isPickerModelSelected('Opus', 'Laufry')).toBe(false)
  })
})
