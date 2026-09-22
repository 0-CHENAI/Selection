import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('draft chat composer width', () => {
  it('shares the session composer column so first send does not resize the input', () => {
    const layout = read('../../../../../../packages/ui/src/lib/layout.ts')
    const chatPage = read('../ChatPage.tsx')
    const chatDisplay = read('../../components/app-shell/ChatDisplay.tsx')
    const inputZone = read('../../components/app-shell/input/ChatInputZone.tsx')

    expect(layout).toContain("maxWidth: 'max-w-[840px]'")
    expect(layout).toContain('composerColumn:')
    expect(layout).toContain('${CHAT_LAYOUT.maxWidth} mx-auto w-full')
    expect(chatDisplay).toContain('CHAT_CLASSES.recordRailGrid')
    expect(chatDisplay).toContain('CHAT_CLASSES.recordRailContent')
    expect(chatDisplay).toContain('<ChatInputZone')
    expect(chatPage).toContain('onPermissionModeChange={setPermissionMode}')
    expect(chatPage).toContain('onSwarmEnabledChange={swarmAgentsEnabled ? handleSwarmEnabledChange : undefined}')
    expect(chatPage).toContain('onWorkingDirectoryChange={handleWorkingDirectoryChange}')
    expect(chatPage).toContain('onSourcesChange={handleSourcesChange}')
    expect(chatPage).not.toContain('max-w-[960px]')
    expect(inputZone).toContain('CHAT_CLASSES.composerColumn')
    expect(layout).toContain('recordRailGrid:')
    expect(layout).toContain('grid-cols-[2rem_minmax(0,1fr)]')
  })
})
