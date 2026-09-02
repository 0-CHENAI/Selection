import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

// PanelHeader → AppShellContext transitively imports pdfjs via the renderer graph.
// Vite's ?url suffix isn't supported by bun — mock before dynamic import.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

import type { AppShellContextType } from '@/context/AppShellContext'

let AppShellProvider: typeof import('@/context/AppShellContext').AppShellProvider
let NavigatorPanel: typeof import('../NavigatorPanel').NavigatorPanel
let PanelHeader: typeof import('../PanelHeader').PanelHeader

beforeAll(async () => {
  ;({ AppShellProvider } = await import('@/context/AppShellContext'))
  ;({ NavigatorPanel } = await import('../NavigatorPanel'))
  ;({ PanelHeader } = await import('../PanelHeader'))
})

const DESKTOP_TITLE_SLOT_CENTERED = 'max-w-full overflow-hidden mx-auto'
const COMPACT_OVERLAY_CENTERED = 'absolute inset-y-0 flex items-center pointer-events-none justify-center'
const COMPACT_OVERLAY_START = 'absolute inset-y-0 flex items-center pointer-events-none justify-start'

function renderWithShell(
  node: ReactNode,
  context: Partial<AppShellContextType> = {},
): string {
  return renderToStaticMarkup(
    <AppShellProvider value={context as AppShellContextType}>
      {node}
    </AppShellProvider>,
  )
}

function navigatorSlotHeaderProps(appShell: string): string {
  const slot = appShell.indexOf('navigatorSlot=')
  expect(slot).toBeGreaterThan(-1)
  const headerStart = appShell.indexOf('<PanelHeader', slot)
  expect(headerStart).toBeGreaterThan(slot)
  // Self-closing tag with a large `actions` tree — only the opening props
  // need to carry listTitle + titleAlign="start".
  return appShell.slice(headerStart, headerStart + 280)
}

describe('PanelHeader title alignment', () => {
  it('centers the desktop title slot by default so page headers stay unchanged', () => {
    const html = renderWithShell(<PanelHeader title="Session name" />)

    expect(html).toContain(DESKTOP_TITLE_SLOT_CENTERED)
    expect(html).toContain('Session name')
    expect(html).toContain('pl-4')
    expect(html).not.toContain(COMPACT_OVERLAY_START)
  })

  it('drops mx-auto on the desktop title slot when start-aligned, keeping list padding and right actions', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        actions={<button type="button">Filter</button>}
      />,
    )

    expect(html).toContain('所有会话')
    expect(html).not.toContain(DESKTOP_TITLE_SLOT_CENTERED)
    expect(html).toContain('max-w-full overflow-hidden')
    expect(html).toContain('pl-4')
    expect(html.indexOf('所有会话')).toBeLessThan(html.indexOf('Filter'))
  })

  it('keeps the title after a leading action and uses back-button padding', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        leadingAction={<button type="button">Back</button>}
      />,
    )

    expect(html).not.toContain(DESKTOP_TITLE_SLOT_CENTERED)
    expect(html).toContain('Back')
    expect(html).toContain('pl-2')
    expect(html.indexOf('Back')).toBeLessThan(html.indexOf('所有会话'))
  })

  it('keeps the compact overlay centered unless start alignment is requested', () => {
    const centered = renderWithShell(
      <PanelHeader title="Session name" />,
      { isCompactMode: true },
    )
    expect(centered).toContain(COMPACT_OVERLAY_CENTERED)
    expect(centered).not.toContain(COMPACT_OVERLAY_START)

    const startAligned = renderWithShell(
      <PanelHeader title="所有会话" titleAlign="start" />,
      { isCompactMode: true },
    )
    expect(startAligned).toContain(COMPACT_OVERLAY_START)
    expect(startAligned).not.toContain(COMPACT_OVERLAY_CENTERED)
  })

  it('does not treat a title-menu chevron justify-center as overlay centering', () => {
    const html = renderWithShell(
      <PanelHeader title="所有会话" titleAlign="start" titleMenu={<div>Rename</div>} />,
      { isCompactMode: true },
    )

    expect(html).toContain(COMPACT_OVERLAY_START)
    expect(html).not.toContain(COMPACT_OVERLAY_CENTERED)
    expect(html).toContain('justify-center')
  })

  it('reserves compact insets for the back button and right-side filter', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        leadingAction={<button type="button">Back</button>}
        actions={<button type="button">Filter</button>}
      />,
      { isCompactMode: true },
    )

    expect(html).toContain('Back')
    expect(html).toContain('Filter')
    expect(html).toContain(COMPACT_OVERLAY_START)
    expect(html).toMatch(/left:\s*66px/)
    expect(html).toMatch(/right:\s*66px/)
  })
})

describe('Navigator list headers opt into start alignment', () => {
  it('NavigatorPanel forwards start alignment onto PanelHeader', () => {
    const html = renderWithShell(
      <NavigatorPanel title="所有会话" width={320} headerActions={<button type="button">Filter</button>}>
        <div>list</div>
      </NavigatorPanel>,
    )

    expect(html).not.toContain(DESKTOP_TITLE_SLOT_CENTERED)
    expect(html.indexOf('所有会话')).toBeLessThan(html.indexOf('Filter'))
  })

  it('wires titleAlign=start onto the live AppShell navigatorSlot PanelHeader', () => {
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const header = navigatorSlotHeaderProps(appShell)

    expect(header).toContain('title={isSidebarVisible ? listTitle : undefined}')
    expect(header).toContain('titleAlign="start"')
  })
})
