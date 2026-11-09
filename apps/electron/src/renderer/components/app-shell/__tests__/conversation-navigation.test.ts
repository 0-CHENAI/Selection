import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  navigationMutationNeedsMeasure,
  shouldReserveConversationNavigationColumn,
  shouldShowConversationNavigation,
} from '../conversation-navigation'

describe('shouldShowConversationNavigation (#394)', () => {
  it('shows the rail only when enabled and there are at least two records', () => {
    expect(shouldShowConversationNavigation(true, 2)).toBe(true)
    expect(shouldShowConversationNavigation(true, 1)).toBe(false)
    expect(shouldShowConversationNavigation(true, 0)).toBe(false)
    expect(shouldShowConversationNavigation(false, 4)).toBe(false)
  })
})

describe('navigation mutations during streaming', () => {
  function target(insideTurn: boolean) {
    return { closest: (selector: string) => selector === '[data-chat-turn-key]' && insideTurn ? {} : null }
  }
  it('ignores text inserted inside a turn and still measures a new record', () => {
    expect(navigationMutationNeedsMeasure([{ target: target(true) }])).toBe(false)
    expect(navigationMutationNeedsMeasure([{ target: target(false) }])).toBe(true)
    expect(navigationMutationNeedsMeasure([{ target: target(true) }, { target: target(false) }])).toBe(true)
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

  it('reserves the 2rem column with the feature flag, and only paints ticks once a second record exists', () => {
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
