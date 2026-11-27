import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { StructuredInput } from '../StructuredInput'
import { describe, expect, it } from 'bun:test'
import { canAlwaysAllowPermission } from './PermissionRequest'

describe('canAlwaysAllowPermission', () => {
  it('requires one-shot approval for every developer feedback tool alias', () => {
    expect(canAlwaysAllowPermission('send_developer_feedback')).toBe(false)
    expect(canAlwaysAllowPermission('session__send_developer_feedback')).toBe(false)
    expect(canAlwaysAllowPermission('mcp__session__send_developer_feedback')).toBe(false)
  })

  it('keeps the existing always-allow action for other permission requests', () => {
    expect(canAlwaysAllowPermission('Bash')).toBe(true)
    expect(canAlwaysAllowPermission('mcp__github__create_issue')).toBe(true)
  })
})

it.each(['permission', 'admin_approval'] as const)('keeps the next %s clickable and allows retry after a failed reply', async type => {
  let fail = false
  const card = (requestId: string) => createElement(StructuredInput, {
    state: type === 'permission'
      ? { type, data: { requestId, sessionId: 'chat', toolName: 'mcp__source__recall', description: 'Recall' } }
      : { type, data: { requestId, appName: 'Test', command: 'test', reason: 'Test approval' } },
    onResponse: async () => { if (fail) throw new Error('Disconnected') },
  })
  let view!: ReactTestRenderer
  const needsWindow = typeof window === 'undefined'
  if (needsWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  const allow = () => view.root.findAllByType('button')[0]!
  try {
    await act(async () => { view = create(card('first')) })
    await act(async () => { allow().props.onClick() })
    expect(allow().props.disabled).toBe(true)
    await act(async () => { view.update(card('second')) })
    expect(allow().props.disabled).toBe(false)
    fail = true
    await act(async () => { allow().props.onClick() })
    expect(allow().props.disabled).toBe(false)
  } finally {
    await act(async () => { view?.unmount() })
    if (needsWindow) Reflect.deleteProperty(globalThis, 'window')
  }
})
