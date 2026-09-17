import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('draft chat composer width', () => {
  it('shares the session composer column so first send does not resize the input', () => {
    const layout = read('../../../../../../packages/ui/src/lib/layout.ts')
    const draft = read('../DraftChatPage.tsx')
    const inputZone = read('../../components/app-shell/input/ChatInputZone.tsx')

    expect(layout).toContain("maxWidth: 'max-w-[840px]'")
    expect(layout).toContain('composerColumn:')
    expect(layout).toContain('${CHAT_LAYOUT.maxWidth} mx-auto w-full')
    expect(draft).toContain('CHAT_CLASSES.composerColumn')
    expect(draft).toContain('CHAT_CLASSES.recordRailGrid')
    expect(draft).toContain('CHAT_CLASSES.recordRailContent')
    expect(draft).not.toContain('max-w-[960px]')
    expect(inputZone).toContain('CHAT_CLASSES.composerColumn')
    expect(layout).toContain('recordRailGrid:')
    expect(layout).toContain('grid-cols-[2rem_minmax(0,1fr)]')
  })
})
