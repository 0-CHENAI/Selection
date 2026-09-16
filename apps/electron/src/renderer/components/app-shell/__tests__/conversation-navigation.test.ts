import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldShowConversationNavigation } from '../conversation-navigation'

describe('shouldShowConversationNavigation (#394)', () => {
  it('shows the rail only when enabled and there are records', () => {
    expect(shouldShowConversationNavigation(true, 2)).toBe(true)
    expect(shouldShowConversationNavigation(true, 0)).toBe(false)
    expect(shouldShowConversationNavigation(false, 4)).toBe(false)
  })
})

describe('ChatDisplay record navigation (#394)', () => {
  const source = readFileSync(join(import.meta.dir, '../ChatDisplay.tsx'), 'utf8')

  it('gates the rail and the 2rem placeholder behind the same flag', () => {
    expect(source).toContain('showRecordNavigation = true')
    expect(source).toContain('if (!showRecordNavigation) return []')
    expect(source).toContain('shouldShowConversationNavigation(showRecordNavigation, navigationItems.length)')
    expect(source).toContain('showNavigationRail && (')
    expect(source).toContain('showNavigationRail && "grid-cols-[2rem_minmax(0,1fr)]"')
    expect(source).toContain('showNavigationRail && "col-start-2"')
  })
})
