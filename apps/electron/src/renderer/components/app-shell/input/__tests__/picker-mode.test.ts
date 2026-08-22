/**
 * Truth table for `derivePickerMode`.
 */

import { describe, test, expect } from 'bun:test'
import { derivePickerMode, type PickerModeInput } from '../picker-mode'

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
