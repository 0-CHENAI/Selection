import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { createStore, Provider } from 'jotai'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { AppShellContextType } from '@/context/AppShellContext'
import type { SessionListContextValue } from '@/context/SessionListContext'
import type { SessionMeta } from '@/atoms/sessions'
import { messagingBindingsAtom, type MessagingBinding } from '@/atoms/messaging'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let AppShellProvider: typeof import('@/context/AppShellContext').AppShellProvider
let SessionListProvider: typeof import('@/context/SessionListContext').SessionListProvider
let SessionItem: typeof import('../SessionItem').SessionItem
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider
let ActionRegistryProvider: typeof import('@/actions/registry').ActionRegistryProvider
const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: LOCALE_REGISTRY.en.messages } } })
  ;({ ActionRegistryProvider } = await import('@/actions/registry'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
  ;({ AppShellProvider } = await import('@/context/AppShellContext'))
  ;({ SessionListProvider } = await import('@/context/SessionListContext'))
  ;({ SessionItem } = await import('../SessionItem'))
})

function wrap(
  ui: ReactNode,
  listContext: Partial<SessionListContextValue> = {},
  store?: ReturnType<typeof createStore>,
) {
  const tree = (
    <I18nextProvider i18n={i18n}>
      <AppShellProvider value={{ workspaces: [] } as unknown as AppShellContextType}>
        <SessionListProvider value={{ contentSearchResults: new Map(), ...listContext } as unknown as SessionListContextValue}>
          <ActionRegistryProvider>
            <TooltipProvider>{ui}</TooltipProvider>
          </ActionRegistryProvider>
        </SessionListProvider>
      </AppShellProvider>
    </I18nextProvider>
  )
  return renderToStaticMarkup(store ? <Provider store={store}>{tree}</Provider> : tree)
}

const FORK_REDUCE = { id: 'proj-fork', slug: 'fork-reduce', name: 'Fork Reduce', color: '#64748b' }

function renderProjectSession(
  item: Partial<SessionMeta> & Pick<SessionMeta, 'id'>,
  store?: ReturnType<typeof createStore>,
) {
  return wrap(
    <SessionItem
      item={{ name: '项目初步查看', lastMessageAt: 1_700_000_000_000, ...item } as SessionMeta}
      index={0}
      isFirstInGroup
      isSelected={false}
      isInMultiSelect={false}
      itemProps={{ onKeyDown: () => {} }}
      onSelect={() => {}}
    />,
    { projects: [FORK_REDUCE] },
    store,
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

describe('session row project name tag', () => {
  it('shares one session row across project lists and all sessions', () => {
    const sessionList = readFileSync(join(import.meta.dir, '../SessionList.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const sessionItem = readFileSync(join(import.meta.dir, '../SessionItem.tsx'), 'utf8')

    expect(sessionList.match(/<SessionItem\b/g)).toHaveLength(1)
    expect(appShell.match(/<SessionList\b/g)).toHaveLength(1)
    expect(sessionItem).not.toContain('projectName')
    expect(sessionItem).not.toContain('max-w-[120px]')
  })

  it('does not render the bound project name beside the title', () => {
    const html = renderProjectSession({ id: 's1', projectId: 'proj-fork' })

    expect(html).toContain('项目初步查看')
    expect(html).not.toContain('Fork Reduce')
    expect(html).not.toContain('max-w-[120px]')
    expect(html).toContain('font-sans truncate min-w-0')
    expect(html).toContain('w-[3px]')
    expect(html).toContain('background-color:#64748b')
  })

  it('keeps two-line clamping when the row has no trailing timestamp', () => {
    const html = renderProjectSession({
      id: 's-long',
      projectId: 'proj-fork',
      name: '项目初步查看：这是一个很长的会话标题用来确认截断仍然生效',
      lastMessageAt: undefined,
    })

    expect(html).toContain('项目初步查看：这是一个很长的会话标题用来确认截断仍然生效')
    expect(html).not.toContain('Fork Reduce')
    expect(html).toContain('line-clamp-2 min-w-0')
  })

  it('keeps the messaging platform badge without the project name', () => {
    const store = createStore()
    store.set(messagingBindingsAtom, [{
      id: 'bind-1',
      workspaceId: 'ws',
      sessionId: 's1',
      platform: 'lark',
      channelId: 'ch',
      enabled: true,
      createdAt: 1,
    } satisfies MessagingBinding])

    const html = renderProjectSession({ id: 's1', projectId: 'proj-fork' }, store)

    expect(html).toContain('Lark / Feishu')
    expect(html).toContain('项目初步查看')
    expect(html).not.toContain('Fork Reduce')
    expect(html).toContain('font-sans truncate min-w-0')
  })
})
