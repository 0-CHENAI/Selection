import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression: on the Office home the empty message list overflowed its fixed 126px box
// and lay on top of the PPT | Word | Excel switch, so clicks on Word / Excel never
// reached the buttons. The browser check is scripts/check-office-mode-switch.cjs.
describe('office home mode switch', () => {
  const chatDisplay = readFileSync(join(import.meta.dir, '../app-shell/ChatDisplay.tsx'), 'utf8')

  it('clips the hero box and keeps the empty message list out of layout', () => {
    expect(chatDisplay).toContain("officeHome ? 'shrink-0 overflow-hidden' : 'flex-1'")
    expect(chatDisplay).toContain("className={cn('h-full', officeHome && 'hidden')}")
  })

  it('still wires the switch to the Office section change', () => {
    expect(chatDisplay).toContain('<OfficeModeSwitcher section={homeSection} onChange={onOfficeSectionChange} />')
  })
})
