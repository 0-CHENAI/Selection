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
