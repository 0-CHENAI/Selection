import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('task card dock', () => {
  test('pins the latest list above the input and keeps the scroll button off the card when it is hidden', () => {
    const chat = read('../ChatDisplay.tsx')
    const zone = read('../input/ChatInputZone.tsx')
    expect(chat).toContain('beforeInput={taskCardEnabled && latestTodo ? (')
    expect(chat).toContain('<TaskProgressCard')
    expect(chat).toContain('showScrollToBottom={showScrollToBottom && taskCard.docked}')
    expect(chat).toContain('showScrollToBottom && !showTaskCard')
    expect(chat).toContain('data-testid="chat-scroll-to-bottom"')
    expect(chat).toContain('todoRail={todoRailForTurn({')
    expect(chat).toContain('useSessionTaskCard')
    expect(chat).toContain('height: showTaskCard ? 16 : 0')
    expect(zone).toContain('{beforeInput}')
    expect(zone).toContain('CHAT_CLASSES.composerColumn')
    const cardAt = zone.indexOf('{beforeInput}')
    const inputAt = zone.indexOf('<InputErrorBoundary')
    expect(cardAt).toBeGreaterThan(0)
    expect(cardAt).toBeLessThan(inputAt)
  })
})
