import { beforeAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { TooltipProvider } from '@craft-agent/ui'
import type { PptProgress } from '@craft-agent/shared/protocol'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { sessionAtomFamily } from '@/atoms/sessions'
import type { Session } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let OfficeCollaborationButton: typeof import('./OfficeCollaborationButton').OfficeCollaborationButton

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
  ;({ OfficeCollaborationButton } = await import('./OfficeCollaborationButton'))
})

function progress(extra: Partial<PptProgress> = {}): PptProgress {
  return {
    total: 15,
    completed: 5,
    current: 6,
    currentTitle: '市场机会',
    generating: true,
    ...extra,
  }
}

function renderButton(session: Partial<Session> | null, active = true) {
  const store = createStore()
  if (session) store.set(sessionAtomFamily('s1'), { id: 's1', ppt: {}, ...session } as Session)
  const toggles: boolean[] = []
  const html = renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <AppShellProvider value={{
            officeCollaboration: {
              sessionId: 's1',
              available: false,
              active,
              choosing: false,
              onToggle: () => { toggles.push(true) },
            },
          } as AppShellContextType}>
            <OfficeCollaborationButton sessionId="s1" />
          </AppShellProvider>
        </TooltipProvider>
      </I18nextProvider>
    </Provider>,
  )
  return { html, toggles }
}

test('generation fills the Office button and keeps stop off it', () => {
  const { html } = renderButton({ isProcessing: true, pptProgress: progress() }, true)
  expect(html).toContain('Office 协同 · 6/15')
  expect(html).toContain('data-testid="office-collaboration-progress"')
  expect(html).toContain('data-progress="0.4"')
  expect(html).toContain('width:40%')
  expect(html).toContain('data-ppt-tooltip="第 6/15 页 · 市场机会"')
  expect(html).toContain('data-generating="true"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).not.toContain('lucide-check')
  expect(html).not.toContain('停止')
  expect(html).not.toContain('border-dashed')
  expect(html).not.toContain('rounded-full')
})

test('a settled deck restores the checked Office button', () => {
  const { html } = renderButton({
    isProcessing: false,
    pptProgress: progress({ generating: false, completed: 15, current: undefined, currentTitle: undefined }),
  }, true)
  expect(html).toContain('>Office 协同<')
  expect(html).toContain('lucide-check')
  expect(html).not.toContain('data-testid="office-collaboration-progress"')
  expect(html).not.toContain('data-generating')
  expect(html).not.toContain('6/15')
  expect(html).not.toContain('停止')
})

test('the button stays available before a page count exists and stays hidden for other chats', () => {
  const early = renderButton({ isProcessing: true, pptProgress: progress({ total: 0, completed: 0, current: undefined, currentTitle: undefined }) }, false)
  expect(early.html).toContain('data-generating="true"')
  expect(early.html).toContain('>Office 协同<')
  expect(early.html).not.toContain('data-testid="office-collaboration-progress"')
  expect(early.html).not.toContain('0/0')

  const other = renderButton({ id: 's1', ppt: undefined, isProcessing: true } as Partial<Session>, false)
  expect(other.html).not.toContain('data-office-collaboration')
})
