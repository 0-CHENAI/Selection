import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const turnCardSrc = readFileSync(join(__dirname, '../TurnCard.tsx'), 'utf8')

describe('streaming footer wiring (#203)', () => {
  it('gates the desktop Streaming... row through shouldShowStreamingFooter', () => {
    expect(turnCardSrc).toContain('shouldShowStreamingFooter')
    expect(turnCardSrc).toContain('hasToolActivities')
    expect(turnCardSrc).toContain('isTurnComplete={isComplete}')
    expect(turnCardSrc).toContain('showStreamingFooter &&')
    expect(turnCardSrc).not.toContain('{!compactMode && isStreaming && (')
  })
})
