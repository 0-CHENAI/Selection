import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('office chat column', () => {
  it('reserves the chat minimum in the shared office layout and the drag clamp', () => {
    const panel = read('../OfficePreviewPanel.tsx')
    const handle = read('../OfficePreviewResizeHandle.tsx')
    const app = read('../../../App.tsx')
    const slot = read('../PanelSlot.tsx')
    expect(panel).toContain('officePanelWidthCss()')
    expect(panel).toContain('bindOfficeLeadingWidth(layout)')
    expect(panel).toContain('className="flex flex-1 min-h-0 @container/office-layout"')
    expect(handle).toContain('officePanelLimits(total, officeLeadingWidthPx(panel))')
    expect(handle).not.toContain('total - PANEL_MIN_WIDTH')
    expect(app).toContain('<OfficeLayoutFrame>')
    expect(app).toContain('hasTrailingPanel={officePreviewPresent}')
    expect(slot).toContain('minWidth: 0')
    expect(slot).toContain('leadingAction: backButton ?? parentContext.leadingAction')
  })

  it('auto-collapses only the PPT history list and leaves a manual toggle', () => {
    const appShell = read('../AppShell.tsx')
    expect(appShell).toContain('reducePptHistoryList(current, { type: \'office\', open: officeOpensPptList })')
    expect(appShell).toContain('const officeOpensPptList = isOfficeArea && hasTrailingPanel && !isAutoCompact')
    expect(appShell).toContain('data-testid="ppt-history-toggle"')
    expect(appShell).toContain('data-ppt-history-list={isOfficeArea ? (pptHistoryOpen ? \'open\' : \'closed\') : undefined}')
    expect(appShell).toContain('leadingAction: hidePptHistoryList ? pptHistoryToggle ?? undefined : undefined')
    expect(appShell).toContain('leadingAction={null}')
    expect(read('../PanelHeader.tsx')).toContain('explicitLeadingAction !== undefined')
    expect(appShell).toContain('!chromeHidden && displayedNavigatorWidth > 0')
    expect(appShell).toContain('<PanelLeftRounded className="h-4 w-4" />')
    expect(appShell).not.toContain('storage.set(storage.KEYS.sessionListWidth, 0)')
  })

  it('wraps composer controls instead of letting them cover the send button', () => {
    const badges = read('../ActiveOptionBadges.tsx')
    const input = read('../input/FreeFormInput.tsx')
    expect(badges).toContain('center ? "flex-nowrap" : "flex-wrap"')
    expect(badges).toContain('data-toolbar-row')
    expect(input).toContain('flex flex-wrap items-center gap-1 px-2 py-2')
    expect(input).toContain('ml-auto flex max-w-full min-w-0 items-center')
    expect(input).not.toContain('min-w-32')
  })
})
