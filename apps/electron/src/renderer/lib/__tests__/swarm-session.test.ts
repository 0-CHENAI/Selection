import { describe, expect, test } from 'bun:test'
import { deriveOrchestrationDisplayState, isOrdinarySessionVisible } from '../swarm-session.ts'

describe('isOrdinarySessionVisible', () => {
  test('keeps parent and coordinator sessions visible', () => {
    expect(isOrdinarySessionVisible({})).toBe(true)
    expect(isOrdinarySessionVisible({ orchestrationRole: 'coordinator' })).toBe(true)
  })

  test('hides explicit hidden sessions and Swarm implementation children', () => {
    expect(isOrdinarySessionVisible({ hidden: true })).toBe(false)
    expect(isOrdinarySessionVisible({ orchestrationRole: 'worker' })).toBe(false)
    expect(isOrdinarySessionVisible({ orchestrationRole: 'reviewer' })).toBe(false)
  })
})

describe('deriveOrchestrationDisplayState', () => {
  test('maps active and successful runs to lightweight title states', () => {
    expect(deriveOrchestrationDisplayState('running')).toBe('running')
    expect(deriveOrchestrationDisplayState('verifying')).toBe('running')
    expect(deriveOrchestrationDisplayState('completed')).toBe('completed')
  })

  test('maps every intervention state to need-to-check', () => {
    for (const status of ['need-to-check', 'failed', 'invalid', 'waiting-approval', 'waiting-budget', 'interrupted', 'stopped']) {
      expect(deriveOrchestrationDisplayState(status)).toBe('need-to-check')
    }
  })

  test('does not decorate sessions without an active run', () => {
    expect(deriveOrchestrationDisplayState()).toBeNull()
  })
})
