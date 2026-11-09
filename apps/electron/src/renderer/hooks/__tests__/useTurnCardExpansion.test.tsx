import * as React from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useTurnCardExpansion } from '../useTurnCardExpansion'
import * as storage from '../../lib/local-storage'

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const entries = new Map<string, string>()
const storageKey = storage.getKeyString(storage.KEYS.turnCardExpansion)
let renderer: ReactTestRenderer
let expansion: ReturnType<typeof useTurnCardExpansion>
const commits: { sessionId: string | undefined; turns: string[]; groups: string[] }[] = []

function Panel({ sessionId }: { sessionId?: string }) {
  const state = useTurnCardExpansion(sessionId)
  React.useLayoutEffect(() => {
    expansion = state
    commits.push({ sessionId, turns: [...state.expandedTurns], groups: [...state.expandedActivityGroups] })
  })
  return null
}
function mount(sessionId?: string) { act(() => { renderer = create(<Panel sessionId={sessionId} />) }) }
function switchTo(sessionId?: string) { act(() => renderer.update(<Panel sessionId={sessionId} />)) }
function stored() { return JSON.parse(entries.get(storageKey) ?? '{}') }

beforeEach(() => {
  entries.clear(); commits.length = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  } })
})
afterEach(() => act(() => renderer?.unmount()))
afterAll(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('manual process expansion persistence', () => {
  it('defaults to collapsed and ignores legacy automatically expanded history', () => {
    const legacy = JSON.stringify({ normal: { turns: ['same-turn'], groups: ['same-group'], lastAccessed: 1 } })
    entries.set('craft-turncard-expansion', legacy)
    mount('normal')
    expect([...expansion.expandedTurns]).toEqual([])
    expect([...expansion.expandedActivityGroups]).toEqual([])
    expect(entries.get('craft-turncard-expansion')).toBe(legacy)
    expect(stored()).toEqual({})
  })

  it('never commits or persists another session’s choices when IDs are reused', () => {
    mount('normal')
    act(() => {
      expansion.toggleTurn('same-turn', true)
      expansion.setExpandedActivityGroups(new Set(['same-group']))
    })
    expect(expansion.expandedTurns.has('new-turn')).toBe(false)
    switchTo('project')
    expect(commits.at(-1)).toEqual({ sessionId: 'project', turns: [], groups: [] })
    expect(commits.filter(commit => commit.sessionId === 'project').every(commit => !commit.turns.length && !commit.groups.length)).toBe(true)
    expect(stored().project).toBeUndefined()
    expect(stored().normal.turns).toEqual(['same-turn'])
    act(() => expansion.toggleTurn('project-turn', true))
    switchTo('normal')
    expect(commits.at(-1)).toEqual({ sessionId: 'normal', turns: ['same-turn'], groups: ['same-group'] })
    expect(stored().project.turns).toEqual(['project-turn'])
    act(() => {
      expansion.toggleTurn('same-turn', false)
      expansion.setExpandedActivityGroups(new Set())
    })
    switchTo('project'); switchTo('normal')
    expect([...expansion.expandedTurns]).toEqual([])
    expect(stored().normal).toBeUndefined()
    expect(stored().project.turns).toEqual(['project-turn'])
  })

  it('restores only the corresponding manual choices on history remount and direct session switches', () => {
    entries.set(storageKey, JSON.stringify({
      normal: { turns: ['normal-turn'], groups: ['normal-group'], lastAccessed: 1 },
      project: { turns: ['project-turn'], groups: ['project-group'], lastAccessed: 2 },
    }))
    mount('normal')
    switchTo('project')
    switchTo('normal')
    for (const commit of commits) {
      expect(commit.turns).toEqual([`${commit.sessionId}-turn`])
      expect(commit.groups).toEqual([`${commit.sessionId}-group`])
    }
    act(() => renderer.unmount())
    mount('project')
    expect([...expansion.expandedTurns]).toEqual(['project-turn'])
    switchTo(undefined)
    expect(commits.at(-1)).toEqual({ sessionId: undefined, turns: [], groups: [] })
    expect(stored().project.turns).toEqual(['project-turn'])
  })
})
