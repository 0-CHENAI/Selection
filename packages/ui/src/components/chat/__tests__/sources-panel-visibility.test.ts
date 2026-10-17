import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SOURCE_PANEL_GAP_PX, isSourcesPanelShown, sourceColumnWidth } from '../sources-panel'

describe('sources panel visibility helper', () => {
  it('can hide an open column without forgetting that it was open', () => {
    expect(isSourcesPanelShown(true, false)).toBe(true)
    expect(isSourcesPanelShown(true, true)).toBe(false)
    expect(isSourcesPanelShown(false, false)).toBe(false)
    expect(isSourcesPanelShown(false, true)).toBe(false)
  })

  it('keeps the conversation-to-sources seam at the same width as other panels', () => {
    expect(SOURCE_PANEL_GAP_PX).toBe(6)
    expect(sourceColumnWidth(280)).toBe(286)
    const layout = readFileSync(join(import.meta.dir, '../ResponseSourcesLayout.tsx'), 'utf8')
    const panelGap = readFileSync(join(import.meta.dir, '../../../../../../apps/electron/src/renderer/components/app-shell/panel-constants.ts'), 'utf8')
    expect(panelGap).toContain('export const PANEL_GAP = 6')
    expect(layout).toContain('sourceColumnWidth(panelWidth)')
    expect(layout).toContain('marginLeft: SOURCE_PANEL_GAP_PX')
    expect(layout).toContain("position: 'absolute'")
    expect(layout).toContain('margin: 0')
    expect(layout).not.toContain('w-1.5')
    expect(layout).not.toContain('panelWidth + 6')
  })
})
