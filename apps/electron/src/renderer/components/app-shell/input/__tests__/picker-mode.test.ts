/**
 * Truth table for `derivePickerMode`.
 */

import { describe, test, expect } from 'bun:test'
import { derivePickerMode, type PickerModeInput } from '../picker-mode'

function input(overrides: Partial<PickerModeInput> = {}): PickerModeInput {
  return {
    connectionUnavailable: false,
    isEmptySession: false,
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
          isEmptySession: true,
          connectionCount: 5,
        }),
      ),
    ).toBe('unavailable')
  })

  test('empty session + ≥2 connections → switcher (#727)', () => {
    expect(
      derivePickerMode(
        input({
          isEmptySession: true,
          connectionCount: 2,
        }),
      ),
    ).toBe('switcher')
  })

  test('empty session + many connections → switcher', () => {
    expect(
      derivePickerMode(
        input({
          isEmptySession: true,
          connectionCount: 7,
        }),
      ),
    ).toBe('switcher')
  })

  test('non-empty session + multiple connections → flat (session already locked to one connection)', () => {
    expect(
      derivePickerMode(
        input({
          isEmptySession: false,
          connectionCount: 5,
        }),
      ),
    ).toBe('flat')
  })

  test('empty session + only 1 connection → flat (list that connection\'s models)', () => {
    expect(
      derivePickerMode(
        input({
          isEmptySession: true,
          connectionCount: 1,
        }),
      ),
    ).toBe('flat')
  })

  test('non-empty session + 1 connection → flat', () => {
    expect(
      derivePickerMode(
        input({
          isEmptySession: false,
          connectionCount: 1,
        }),
      ),
    ).toBe('flat')
  })

  test('connectionCount=0 (no connections configured) → flat (defensive fallthrough)', () => {
    expect(
      derivePickerMode(
        input({ isEmptySession: true, connectionCount: 0 }),
      ),
    ).toBe('flat')
  })
})
