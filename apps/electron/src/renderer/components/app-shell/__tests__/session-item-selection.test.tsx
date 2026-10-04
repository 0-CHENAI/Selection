import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppShellContextType } from '@/context/AppShellContext'
import type { SessionListContextValue } from '@/context/SessionListContext'
import type { SessionMeta } from '@/atoms/sessions'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let AppShellProvider: typeof import('@/context/AppShellContext').AppShellProvider
let SessionListProvider: typeof import('@/context/SessionListContext').SessionListProvider
let SessionItem: typeof import('../SessionItem').SessionItem
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider
let ActionRegistryProvider: typeof import('@/actions/registry').ActionRegistryProvider

beforeAll(async () => {
  ;({ ActionRegistryProvider } = await import('@/actions/registry'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
  ;({ AppShellProvider } = await import('@/context/AppShellContext'))
  ;({ SessionListProvider } = await import('@/context/SessionListContext'))
  ;({ SessionItem } = await import('../SessionItem'))
})

function render(selected: boolean, multiSelected: boolean, keyboardActive: boolean) {
  return renderToStaticMarkup(
    <AppShellProvider value={{ workspaces: [] } as unknown as AppShellContextType}>
      <SessionListProvider value={{ contentSearchResults: new Map() } as unknown as SessionListContextValue}>
        <ActionRegistryProvider>
          <TooltipProvider>
            <SessionItem
              item={{ id: 'previous', name: '原会话', lastMessageAt: 1 } as SessionMeta}
              index={0}
              isFirstInGroup
              isSelected={selected}
              isInMultiSelect={multiSelected}
              itemProps={{ 'aria-selected': keyboardActive, onKeyDown: () => {} }}
              onSelect={() => {}}
            />
          </TooltipProvider>
        </ActionRegistryProvider>
      </SessionListProvider>
    </AppShellProvider>,
  )
}

describe('session row selection', () => {
  it('a previous keyboard cursor does not mark an inactive conversation selected', () => {
    const html = render(false, false, true)
    expect(html).toContain('aria-selected="false"')
    expect(html).not.toContain('data-selected="true"')
  })

  it('an active conversation stays selected regardless of the keyboard cursor', () => {
    const html = render(true, false, false)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('data-selected="true"')
  })

  it('keeps multi-selected conversations accessible', () => {
    expect(render(false, true, false)).toContain('aria-selected="true"')
  })
})
