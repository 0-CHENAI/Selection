import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('task card dock', () => {
  test('floats the latest list over the transcript and keeps the scroll button beside it', () => {
    const chat = read('../ChatDisplay.tsx')
    const zone = read('../input/ChatInputZone.tsx')
    expect(chat).toContain('<TaskProgressCard')
    expect(chat).toContain('showScrollToBottom={showScrollToBottom}')
    expect(chat).toContain('showScrollToBottom && !(taskCardEnabled && latestTodo)')
    expect(chat).toContain('data-testid="chat-scroll-to-bottom"')
    expect(chat).toContain('todoRail={todoRailForTurn({')
    expect(chat).toContain('docked: taskCard.visible || taskCardPresent')
    expect(chat).toContain('superseded: userTurnAfterList')
    expect(chat).toContain('useSessionTaskCard')
    expect(chat).toContain('data-task-card-clearance')
    expect(chat).toContain('height: showTaskCard || taskCardPresent ? TASK_CARD_CAPSULE_CLEARANCE : 0')
    expect(chat).toContain('userTurnAfterList')
    expect(chat).toContain('generationEnded:')
    expect(chat).not.toContain('onDismiss=')
    expect(chat).not.toContain('beforeInput={')
    expect(zone).toContain('{beforeInput}')
    expect(zone).toContain('CHAT_CLASSES.composerColumn')
    const cardAt = chat.indexOf('<TaskProgressCard')
    const scrollAt = chat.indexOf('key="scroll-to-bottom"')
    const inputAt = chat.indexOf('<ChatInputZone')
    expect(cardAt).toBeGreaterThan(0)
    expect(cardAt).toBeLessThan(scrollAt)
    expect(scrollAt).toBeLessThan(inputAt)
  })
})
