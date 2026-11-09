/**
 * Truth table for `derivePickerMode`.
 */

import { describe, test, expect } from 'bun:test'
import { derivePickerMode, pickerPageShowsCurrentConnection, type PickerModeInput } from '../picker-mode'

function input(overrides: Partial<PickerModeInput> = {}): PickerModeInput {
  return {
    connectionUnavailable: false,
    connectionCount: 1,
    ...overrides,
  }
}

describe('derivePickerMode', () => {
  test('connectionUnavailable beats every other flag', () => {
    expect(
      derivePickerMode(
        input({
          connectionUnavailable: true,
          connectionCount: 5,
        }),
      ),
    ).toBe('unavailable')
  })

  test('≥2 connections → switcher so every added provider stays selectable', () => {
    expect(
      derivePickerMode(
        input({
          connectionCount: 2,
        }),
      ),
    ).toBe('switcher')
  })

  test('many connections → switcher', () => {
    expect(
      derivePickerMode(
        input({
          connectionCount: 7,
        }),
      ),
    ).toBe('switcher')
  })

  test('only 1 connection → flat (list that connection\'s models)', () => {
    expect(
      derivePickerMode(
        input({
          connectionCount: 1,
        }),
      ),
    ).toBe('flat')
  })

  test('connectionCount=0 (no connections configured) → flat (defensive fallthrough)', () => {
    expect(
      derivePickerMode(
        input({ connectionCount: 0 }),
      ),
    ).toBe('flat')
  })
})

describe('pickerPageShowsCurrentConnection', () => {
  test('only shows current model controls on the active connection page', () => {
    expect(pickerPageShowsCurrentConnection('flat', undefined, 'chatgpt')).toBe(true)
    expect(pickerPageShowsCurrentConnection('switcher', 'chatgpt', 'chatgpt')).toBe(true)
    expect(pickerPageShowsCurrentConnection('switcher', 'deepseek', 'chatgpt')).toBe(false)
    expect(pickerPageShowsCurrentConnection('switcher', null, 'chatgpt')).toBe(false)
    expect(pickerPageShowsCurrentConnection('switcher', null, null)).toBe(false)
    expect(pickerPageShowsCurrentConnection('unavailable', 'chatgpt', 'chatgpt')).toBe(false)
  })

  test('single-connection flat is already on the current connection page', () => {
    expect(pickerPageShowsCurrentConnection('flat', null, 'laufry')).toBe(true)
    expect(pickerPageShowsCurrentConnection('flat', 'laufry', 'laufry')).toBe(true)
  })
})
