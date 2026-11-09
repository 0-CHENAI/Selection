import { describe, expect, it } from 'bun:test'
import { PERMISSION_MODE_CONFIG, parsePermissionMode } from '../mode-types.ts'

describe('parsePermissionMode', () => {
  it.each([
    'ask', 'Ask to Edit', 'ask-to-edit', 'smart-confirm', 'Smart Confirm', 'smart-approval', 'Smart Approval', 'smart_approval',
  ])('maps "%s" to the internal ask mode', name => {
    expect(parsePermissionMode(name)).toBe('ask')
  })

  it('keeps the other modes and rejects unknown names', () => {
    expect(parsePermissionMode('explore')).toBe('safe')
    expect(parsePermissionMode('execute')).toBe('allow-all')
    expect(parsePermissionMode('smart')).toBeNull()
  })

  it('names the ask mode Smart Approval', () => {
    expect(PERMISSION_MODE_CONFIG.ask.displayName).toBe('Smart Approval')
  })
})
