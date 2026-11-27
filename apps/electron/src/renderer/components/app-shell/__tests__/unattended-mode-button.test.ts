import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const badges = readFileSync(join(import.meta.dir, '../ActiveOptionBadges.tsx'), 'utf8')
const start = badges.indexOf('function UnattendedButton')
const end = badges.indexOf('// Stack the translated labels', start)
const unattended = badges.slice(start, end)

describe('unattended mode toolbar button', () => {
  it('uses an icon-only cloud control instead of a notification bell and visible label', () => {
    expect(unattended).toContain('<CloudOff')
    expect(unattended).toContain('<CloudUpload')
    expect(unattended).not.toContain('<Bell')
    expect(unattended).not.toContain('<BellRing')
    expect(unattended).not.toContain('whitespace-nowrap')
    expect(unattended).toContain("toolbarControlLayout(true, 'permission')")
    expect(unattended).toContain('toolbarControlStyle(true)')
  })

  it('keeps a localized accessible name, description, tooltip, and toggle state semantics', () => {
    expect(unattended).toContain('aria-label={label}')
    expect(unattended).toContain('aria-description={description}')
    expect(unattended).toContain('aria-pressed={enabled}')
    expect(unattended).toContain('<Tooltip>')
    expect(unattended).toContain('<TooltipContent')
    expect(unattended).toContain('<div className="font-medium">{label}</div>')
    expect(unattended).toContain('<div className="mt-0.5 text-foreground/80">{description}</div>')
    expect(unattended).not.toContain('DropdownMenu')
  })

  it('leaves the connected toggle and disconnected settings navigation behavior intact', () => {
    expect(unattended).toContain('setEnabled(!enabled)')
    expect(unattended).toContain("navigate(routes.view.settings('messaging'))")
  })

  it('does not reserve responsive text width for a label that no longer exists', () => {
    expect(badges).not.toContain('unattendedDelta')
    expect(badges).not.toContain('data-toolbar-measure="unattended-text"')
  })
})
