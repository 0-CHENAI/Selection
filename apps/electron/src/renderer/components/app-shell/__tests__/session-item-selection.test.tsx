import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
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
let ExecutionChildren: typeof import('../ExecutionChildren').ExecutionChildren
const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: LOCALE_REGISTRY.en.messages } } })
  ;({ ActionRegistryProvider } = await import('@/actions/registry'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
  ;({ AppShellProvider } = await import('@/context/AppShellContext'))
  ;({ SessionListProvider } = await import('@/context/SessionListContext'))
  ;({ SessionItem } = await import('../SessionItem'))
  ;({ ExecutionChildren } = await import('../ExecutionChildren'))
})

function wrap(ui: ReactNode) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AppShellProvider value={{ workspaces: [] } as unknown as AppShellContextType}>
        <SessionListProvider value={{ contentSearchResults: new Map() } as unknown as SessionListContextValue}>
          <ActionRegistryProvider>
            <TooltipProvider>{ui}</TooltipProvider>
          </ActionRegistryProvider>
        </SessionListProvider>
      </AppShellProvider>
    </I18nextProvider>,
  )
}

function render(selected: boolean, multiSelected: boolean, keyboardActive: boolean) {
  return wrap(
    <SessionItem
      item={{ id: 'previous', name: '原会话', lastMessageAt: 1 } as SessionMeta}
      index={0}
      isFirstInGroup
      isSelected={selected}
      isInMultiSelect={multiSelected}
      itemProps={{ 'aria-selected': keyboardActive, onKeyDown: () => {} }}
      onSelect={() => {}}
    />,
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

describe('execution child disclosure', () => {
  const children = [
    { id: 'reader', name: '读取资料', hasUnread: true },
    { id: 'reviewer', name: '独立核验', isProcessing: true },
  ] as SessionMeta[]

  it('keeps unread and processing children collapsed without hiding the unread summary', () => {
    const html = wrap(<ExecutionChildren children={children} selectedSessionId="root" onSelect={() => {}} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Unread (1)')
    expect(html).not.toContain('data-session-id="reader"')
  })

  it('reveals a selected child and retains its real selection and unread indicator', () => {
    const html = wrap(<ExecutionChildren children={children} selectedSessionId="reader" onSelect={() => {}} />)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-session-id="reader"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-label="Unread (1)"')
  })
})
