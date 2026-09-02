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

describe('PanelHeader title alignment', () => {
  it('centers the title by default so chat and file pages stay unchanged', () => {
    const html = renderWithShell(<PanelHeader title="Session name" />)

    expect(html).toContain('mx-auto')
    expect(html).toContain('Session name')
    expect(html).toContain('truncate')
    expect(html).toContain('pl-4')
    expect(html).not.toContain('justify-start')
  })

  it('left-aligns navigator titles without mx-auto while keeping list padding', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        actions={<button type="button">Filter</button>}
      />,
    )

    expect(html).toContain('所有会话')
    expect(html).not.toContain('mx-auto')
    expect(html).toContain('pl-[26px]')
    expect(html).not.toContain('pl-4')
    expect(html).toContain('truncate')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('min-w-0')
    expect(html.indexOf('所有会话')).toBeLessThan(html.indexOf('Filter'))
    expect(html).toContain('Filter')
    expect(html).toContain('shrink-0')
  })

  it('still left-aligns after a leading action and keeps compact back-button padding', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        leadingAction={<button type="button">Back</button>}
      />,
    )

    expect(html).not.toContain('mx-auto')
    expect(html).toContain('Back')
    expect(html).toContain('pl-2')
    expect(html.indexOf('Back')).toBeLessThan(html.indexOf('所有会话'))
  })

  it('keeps compact overlay titles centered unless start alignment is requested', () => {
    const centered = renderWithShell(
      <PanelHeader title="Session name" />,
      { isCompactMode: true },
    )
    expect(centered).toContain('justify-center')
    expect(centered).not.toContain('justify-start')

    const startAligned = renderWithShell(
      <PanelHeader title="所有会话" titleAlign="start" />,
      { isCompactMode: true },
    )
    expect(startAligned).toContain('justify-start')
    expect(startAligned).not.toContain('justify-center')
    expect(startAligned).toContain('overflow-hidden')
    expect(startAligned).toMatch(/left:\s*26px/)
  })

  it('does not drop compact leading-action compensation when start-aligned', () => {
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
    expect(html).toContain('justify-start')
    expect(html).toContain('z-[1]')
  })
})

describe('Navigator list headers opt into start alignment', () => {
  it('NavigatorPanel pins its title to the left content edge', () => {
    const html = renderWithShell(
      <NavigatorPanel title="所有会话" width={320} headerActions={<button type="button">Filter</button>}>
        <div>list</div>
      </NavigatorPanel>,
    )

    expect(html).toContain('所有会话')
    expect(html).not.toContain('mx-auto')
    expect(html).toContain('pl-[26px]')
    expect(html.indexOf('所有会话')).toBeLessThan(html.indexOf('Filter'))
  })

  it('AppShell navigator header requests start alignment; chat/file pages do not', () => {
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const navigatorSlot = appShell.slice(appShell.indexOf('navigatorSlot='))
    expect(navigatorSlot).toContain('titleAlign="start"')

    const chatPage = readFileSync(
      join(import.meta.dir, '../../../pages/ChatPage.tsx'),
      'utf8',
    )
    expect(chatPage).not.toContain('titleAlign')

    const sourceInfo = readFileSync(
      join(import.meta.dir, '../../../pages/SourceInfoPage.tsx'),
      'utf8',
    )
    expect(sourceInfo).not.toContain('titleAlign')
  })
})
