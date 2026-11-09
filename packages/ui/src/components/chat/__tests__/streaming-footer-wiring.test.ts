import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const turnCardSrc = readFileSync(join(__dirname, '../TurnCard.tsx'), 'utf8')

describe('streaming footer wiring (#203)', () => {
  it('reserves the desktop action row while streaming; completion reveals the actions', () => {
    // The footer row stays mounted from the first tokens so completion only
    // fades the actions in — the card bottom never jumps.
    expect(turnCardSrc).toContain('reserveDesktopFooter')
    expect(turnCardSrc).toContain("isStreaming && variant === 'response'")
    expect(turnCardSrc).toContain('isTurnComplete={isComplete}')
    // Footer actions are gated behind completion chrome, never behind a live
    // footer row: streaming progress belongs on the work chain / turn header.
    expect(turnCardSrc).toContain('showCompletedChrome')
    expect(turnCardSrc).toContain('actionsVisible')
    // The old "Streaming..." spinner footer must not come back — it made a
    // finished preamble look live once tools had started (#203).
    expect(turnCardSrc).not.toContain('showStreamingFooter')
    expect(turnCardSrc).not.toContain('{!compactMode && isStreaming && (')
    expect(turnCardSrc).not.toContain('Streaming...')
  })
})
