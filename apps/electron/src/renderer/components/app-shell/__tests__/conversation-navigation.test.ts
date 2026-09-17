import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  shouldReserveConversationNavigationColumn,
  shouldShowConversationNavigation,
} from '../conversation-navigation'

describe('shouldShowConversationNavigation (#394)', () => {
  it('shows the rail only when enabled and there are records', () => {
    expect(shouldShowConversationNavigation(true, 2)).toBe(true)
    expect(shouldShowConversationNavigation(true, 0)).toBe(false)
    expect(shouldShowConversationNavigation(false, 4)).toBe(false)
  })
})

describe('shouldReserveConversationNavigationColumn', () => {
  it('reserves the gutter whenever the rail feature is on, even before records exist', () => {
    expect(shouldReserveConversationNavigationColumn(true)).toBe(true)
    expect(shouldReserveConversationNavigationColumn(false)).toBe(false)
  })
})

describe('ChatDisplay record navigation (#394)', () => {
  const source = readFileSync(join(import.meta.dir, '../ChatDisplay.tsx'), 'utf8')

  it('reserves the 2rem column with the feature flag, and only paints ticks when records exist', () => {
    expect(source).toContain('showRecordNavigation = true')
    expect(source).toContain('if (!showRecordNavigation) return []')
    expect(source).toContain('shouldShowConversationNavigation(showRecordNavigation, navigationItems.length)')
    expect(source).toContain('shouldReserveConversationNavigationColumn(showRecordNavigation)')
    expect(source).toContain('showNavigationRail && (')
    expect(source).toContain('CHAT_CLASSES.recordRailGrid')
    expect(source).toContain('CHAT_CLASSES.recordRailContent')
    expect(source).not.toContain('showNavigationRail && "grid-cols-[2rem_minmax(0,1fr)]"')
  })
})
