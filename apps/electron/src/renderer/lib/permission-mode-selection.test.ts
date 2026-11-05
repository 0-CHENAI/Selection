import { describe, expect, test } from 'bun:test'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import { commitPermissionModeChange } from './full-takeover-confirmation'
import {
  applyOptimisticPermissionModeChange,
  nextModeAfterDeclinedTakeover,
} from './permission-mode-selection'

/** bun:test's `toBe` keeps the initializer literal; compare through the union. */
function expectMode(actual: PermissionMode, expected: PermissionMode) {
  expect(actual).toBe(expected)
}

describe('applyOptimisticPermissionModeChange', () => {
  test('select Full Takeover then cancel keeps the previous mode in UI and result', async () => {
    let painted: PermissionMode = 'ask'

    const result = await applyOptimisticPermissionModeChange({
      nextMode: 'allow-all',
      currentMode: 'ask',
      setOptimisticMode: (mode) => { painted = mode },
      onChange: async () => false,
    })

    expectMode(result, 'ask')
    expectMode(painted, 'ask')
  })

  test('select Full Takeover then confirm paints and returns allow-all', async () => {
    let painted: PermissionMode = 'ask'
    const applied: PermissionMode[] = []

    const result = await applyOptimisticPermissionModeChange({
      nextMode: 'allow-all',
      currentMode: 'ask',
      setOptimisticMode: (mode) => { painted = mode },
      onChange: async (mode) => {
        applied.push(mode)
        return true
      },
    })

    expectMode(result, 'allow-all')
    expectMode(painted, 'allow-all')
    expect(applied).toEqual(['allow-all'])
  })

  test('cancel after an optimistic paint rolls the badge back to the previous mode', async () => {
    const paints: PermissionMode[] = []
    await applyOptimisticPermissionModeChange({
      nextMode: 'allow-all',
      currentMode: 'safe',
      setOptimisticMode: (mode) => { paints.push(mode) },
      onChange: async () => false,
    })
    expect(paints).toEqual(['allow-all', 'safe'])
  })

  test('gated parent cancel (ChatPage) leaves both UI and session mode unchanged', async () => {
    let sessionMode: PermissionMode = 'ask'
    let painted: PermissionMode = sessionMode

    const result = await applyOptimisticPermissionModeChange({
      nextMode: 'allow-all',
      currentMode: sessionMode,
      setOptimisticMode: (mode) => { painted = mode },
      onChange: (mode) => commitPermissionModeChange(
        mode,
        sessionMode,
        'ws-1',
        (applied) => { sessionMode = applied as PermissionMode },
        async () => false,
      ),
    })

    expectMode(result, 'ask')
    expectMode(painted, 'ask')
    expectMode(sessionMode, 'ask')
  })

  test('gated parent confirm applies allow-all to UI and session', async () => {
    let sessionMode: PermissionMode = 'safe'
    let painted: PermissionMode = sessionMode

    const result = await applyOptimisticPermissionModeChange({
      nextMode: 'allow-all',
      currentMode: sessionMode,
      setOptimisticMode: (mode) => { painted = mode },
      onChange: (mode) => commitPermissionModeChange(
        mode,
        sessionMode,
        'ws-1',
        (applied) => { sessionMode = applied as PermissionMode },
        async () => true,
      ),
    })

    expectMode(result, 'allow-all')
    expectMode(painted, 'allow-all')
    expectMode(sessionMode, 'allow-all')
  })

  test('void handlers (immediate apply) keep the optimistic mode', async () => {
    let painted: PermissionMode = 'ask'
    await applyOptimisticPermissionModeChange({
      nextMode: 'safe',
      currentMode: 'ask',
      setOptimisticMode: (mode) => { painted = mode },
      onChange: () => {},
    })
    expectMode(painted, 'safe')
  })
})

describe('nextModeAfterDeclinedTakeover', () => {
  const all: PermissionMode[] = ['safe', 'ask', 'allow-all']

  test('declining Full Takeover while cycling ask → allow-all skips to safe', () => {
    expect(nextModeAfterDeclinedTakeover(all, 2, 'ask')).toBe('safe')
  })

  test('declining when the only other mode is the current one stays put', () => {
    expect(nextModeAfterDeclinedTakeover(['ask', 'allow-all'], 1, 'ask')).toBeNull()
  })

  test('never returns allow-all after a declined confirmation', () => {
    expect(nextModeAfterDeclinedTakeover(['allow-all', 'allow-all'], 0, 'ask')).toBeNull()
    expect(nextModeAfterDeclinedTakeover(['safe', 'allow-all'], 1, 'safe')).toBeNull()
  })
})
