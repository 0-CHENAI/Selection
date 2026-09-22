import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const badges = readFileSync(join(import.meta.dir, '../ActiveOptionBadges.tsx'), 'utf8')
const app = readFileSync(join(import.meta.dir, '../../../App.tsx'), 'utf8')

describe('permission mode dropdown', () => {
  it('opens with a dropdown list instead of a cmdk popover that auto-selects on mount', () => {
    expect(badges).toContain('data-tutorial="permission-mode-dropdown"')
    expect(badges).toContain('DropdownMenu')
    expect(badges).toContain('PERMISSION_MODE_ORDER.map')
    expect(badges).not.toContain('SlashCommandMenu')
    expect(badges).not.toContain('showFilter')
  })

  it('keeps draft composer mode changes in memory until a session exists', () => {
    expect(app).toContain('isDraftSessionOptionsId(sessionId)')
    expect(app).toContain('if (isDraftSessionOptionsId(sessionId)) return')
  })
})
