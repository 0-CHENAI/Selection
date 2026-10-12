import { afterEach, beforeEach, expect, test } from 'bun:test'
import { KEYS, getKeyString } from './local-storage'
import { officeScrollAnchor, readOfficePreviewState, writeOfficePreviewState } from './office-preview-state'

const scope = { workspaceId: 'workspace-a', sessionId: 'chat-a' }
const state = { open: true, path: '/workspace/report.docx', scrollY: 1320, scrollX: 120, anchor: { path: '/body/p[12]', offset: -32 } }
let previous: PropertyDescriptor | undefined
let values: Map<string, string>

beforeEach(() => {
  previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } })
})
afterEach(() => {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

test('restores open and closed file positions independently by workspace and session', () => {
  writeOfficePreviewState(scope, state)
  writeOfficePreviewState({ ...scope, sessionId: 'chat-b' }, { ...state, open: false, path: '/workspace/table.xlsx', scrollY: 240 })
  writeOfficePreviewState({ ...scope, workspaceId: 'workspace-b' }, { ...state, path: '/other/slides.pptx', scrollY: 900 })
  expect(readOfficePreviewState(scope)).toEqual(state)
  expect(readOfficePreviewState({ ...scope, sessionId: 'chat-b' })).toMatchObject({ open: false, path: '/workspace/table.xlsx', scrollY: 240 })
  expect(readOfficePreviewState({ ...scope, workspaceId: 'workspace-b' })).toMatchObject({ open: true, path: '/other/slides.pptx', scrollY: 900 })
  expect(readOfficePreviewState({ ...scope, sessionId: 'new-chat' })).toBeUndefined()
  // Tuple keys cannot collide when IDs contain separators.
  writeOfficePreviewState({ workspaceId: 'x:y', sessionId: 'z' }, state)
  expect(readOfficePreviewState({ workspaceId: 'x', sessionId: 'y:z' })).toBeUndefined()
})

test('does not persist live preview IDs or version-bound selections', () => {
  writeOfficePreviewState(scope, { ...state, previewId: 'expired', selection: ['old-paragraph'] } as typeof state)
  const raw = JSON.parse(values.get(getKeyString(KEYS.officePreviewState, JSON.stringify([scope.workspaceId, scope.sessionId])))!)
  expect(Object.keys(raw).sort()).toEqual(['anchor', 'open', 'path', 'scrollX', 'scrollY'])
  writeOfficePreviewState({ workspaceId: '', sessionId: 'chat-a' }, state)
  expect(readOfficePreviewState({ workspaceId: '', sessionId: 'chat-a' })).toBeUndefined()
})

test('invalid or older storage cannot reopen arbitrary state or restore invalid offsets', () => {
  const key = getKeyString(KEYS.officePreviewState, JSON.stringify([scope.workspaceId, scope.sessionId]))
  for (const value of ['not-json', 'null', JSON.stringify({ ...state, open: 'true' }), JSON.stringify({ ...state, path: '/workspace/script.js' })]) {
    values.set(key, value)
    expect(readOfficePreviewState(scope)).toBeUndefined()
  }
  values.set(key, JSON.stringify({ ...state, scrollY: 'wrong', anchor: { path: 'x', offset: null } }))
  expect(readOfficePreviewState(scope)).toEqual({ open: true, path: state.path, scrollY: 0, scrollX: 120, anchor: undefined })
  values.set(key, JSON.stringify({ ...state, scrollY: -10 }))
  expect(readOfficePreviewState(scope)?.scrollY).toBe(0)
  expect(officeScrollAnchor({ path: 'x'.repeat(1025), offset: 0 })).toBeUndefined()
  expect(officeScrollAnchor({ path: '/body/p[1]', offset: Infinity })).toBeUndefined()
})
