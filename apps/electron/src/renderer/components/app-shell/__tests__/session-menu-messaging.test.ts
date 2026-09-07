import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellDir = join(import.meta.dir, '..')

function readComponent(name: string): string {
  return readFileSync(join(appShellDir, name), 'utf8')
}

describe('session menus', () => {
  it('does not expose the messaging entry in the desktop menu', () => {
    const source = readComponent('SessionMenu.tsx')

    expect(source).not.toContain('MessagingSessionMenuItem')
    expect(source).not.toContain('connectMessaging')
  })

  it('does not expose a messaging drawer or secondary pane in compact mode', () => {
    const source = readComponent('CompactSessionMenu.tsx')

    expect(source).not.toContain('MessagingPane')
    expect(source).not.toContain('useMessagingConnect')
    expect(source).not.toContain('connectMessaging')
    expect(source).not.toContain("type View = 'root' | 'messaging'")
  })
})
