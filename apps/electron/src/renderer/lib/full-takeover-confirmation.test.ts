import { describe, expect, test } from 'bun:test'
import { createFullTakeoverConfirmation } from './full-takeover-confirmation'

function setup(options: {
  /** Workspaces whose stored setting already records the acknowledgement. */
  acknowledged?: string[]
  confirm?: boolean
  failRead?: boolean
  failSave?: boolean
} = {}) {
  // Mirrors the real storage: the flag lives per workspace, not globally.
  const state = { asks: 0, saves: 0, stored: new Set(options.acknowledged ?? []) }
  const confirmation = createFullTakeoverConfirmation({
    isAcknowledged: async (workspaceId: string) => {
      if (options.failRead) throw new Error('settings unreadable')
      return state.stored.has(workspaceId)
    },
    saveAcknowledged: async (workspaceId: string) => {
      state.saves++
      if (options.failSave) throw new Error('read-only config')
      state.stored.add(workspaceId)
    },
    ask: async () => {
      state.asks++
      return options.confirm ?? true
    },
  })
  return { state, confirmation }
}

describe('Full Takeover confirmation', () => {
  test('asks once per workspace, then remembers the acknowledgement', async () => {
    const { state, confirmation } = setup()

    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.asks).toBe(1)
    expect(state.saves).toBe(1)

    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.asks).toBe(1)
  })

  test('asks again for a different workspace', async () => {
    const { state, confirmation } = setup()

    await confirmation.confirm('ws-1')
    await confirmation.confirm('ws-2')
    expect(state.asks).toBe(2)
  })

  test('a declined confirmation neither proceeds nor remembers', async () => {
    const { state, confirmation } = setup({ confirm: false })

    expect(await confirmation.confirm('ws-1')).toBe(false)
    expect(state.saves).toBe(0)
    expect(await confirmation.confirm('ws-1')).toBe(false)
    expect(state.asks).toBe(2)
  })

  test('an existing workspace setting skips the dialog', async () => {
    const { state, confirmation } = setup({ acknowledged: ['ws-1'] })

    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.asks).toBe(0)
    // Another workspace has its own setting.
    expect(await confirmation.confirm('ws-2')).toBe(true)
    expect(state.asks).toBe(1)
  })

  test('unreadable settings fall back to asking', async () => {
    const { state, confirmation } = setup({ failRead: true })

    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.asks).toBe(1)
  })

  test('the switch proceeds even when the acknowledgement cannot be saved', async () => {
    const { state, confirmation } = setup({ failSave: true })

    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.saves).toBe(1)
    // Not persisted, so the question comes back rather than silently staying armed.
    expect(await confirmation.confirm('ws-1')).toBe(true)
    expect(state.asks).toBe(1)
  })

  test('without a workspace the dialog is asked every time', async () => {
    const { state, confirmation } = setup()

    await confirmation.confirm(null)
    await confirmation.confirm(undefined)
    expect(state.asks).toBe(2)
  })

  test('concurrent triggers share a single dialog', async () => {
    const { state, confirmation } = setup()

    const [a, b] = await Promise.all([confirmation.confirm('ws-1'), confirmation.confirm('ws-1')])
    expect([a, b]).toEqual([true, true])
    expect(state.asks).toBe(1)
  })
})
