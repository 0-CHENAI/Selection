import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { OFFICE_PREVIEW_OPEN_CASE } from '@/lib/office-preview-page'
import { SentOfficeCase, openSentOfficeCase, sentOfficeCase } from './SentOfficeCase'

const i18n = i18next.createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
})
const render = (office: unknown) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><SentOfficeCase office={office} sessionId="s1" /></I18nextProvider>)

describe('sent Word / Excel case card', () => {
  it('shows the case cover in the same card as the PPT reference template, for Word and Excel', () => {
    const word = render({ mode: 'word', templateId: 'government-notice', revision: '20260914.2' })
    expect(word).toContain('data-testid="office-sent-case"')
    expect(word).toContain('government-notice.webp')
    expect(word).toContain('alt="参考案例：中国中车质量安全月活动通知"')
    expect(word).toContain('aria-label="预览样例：中国中车质量安全月活动通知"')
    // Same footprint as SentTemplateReference.
    for (const cls of ['h-14', 'w-[98px]', 'rounded-[8px]', 'object-cover']) expect(word).toContain(cls)
    const ppt = readFileSync(join(import.meta.dir, '../ppt/SentTemplateReference.tsx'), 'utf8')
    for (const cls of ['h-14', 'w-[98px]', 'rounded-[8px]', 'object-cover']) expect(ppt).toContain(cls)
    const excel = render({ mode: 'excel', templateId: 'port-cargo', revision: '20260911.6' })
    expect(excel).toContain('port-cargo.webp')
    expect(excel).toContain('<button')
  })

  it('renders nothing without a case, for a mode mismatch or for PPT', () => {
    expect(sentOfficeCase(undefined)).toBeUndefined()
    expect(sentOfficeCase({ mode: 'word' })).toBeUndefined()
    expect(sentOfficeCase({ mode: 'excel', templateId: 'government-notice' })).toBeUndefined()
    expect(sentOfficeCase({ mode: 'ppt', templateId: 'dsh-cartesian' })).toBeUndefined()
    expect(render({ mode: 'word' })).toBe('')
    expect(render(null)).toBe('')
  })

  it('a case without a sample file is a plain card; one with a sample opens it read-only for this chat', async () => {
    const tracker = render({ mode: 'excel', templateId: 'execution-tracker', revision: 'selection-o5' })
    expect(tracker).toContain('data-testid="office-sent-case"')
    expect(tracker).not.toContain('<button')
    const seen: unknown[] = []
    const runtime = globalThis as { window?: unknown }
    const hadWindow = 'window' in runtime
    if (!hadWindow) runtime.window = new EventTarget()
    const bus = runtime.window as EventTarget
    const listener = (event: Event) => seen.push((event as CustomEvent).detail)
    bus.addEventListener(OFFICE_PREVIEW_OPEN_CASE, listener)
    try {
      openSentOfficeCase('coffee-market', 's1')
    } finally {
      bus.removeEventListener(OFFICE_PREVIEW_OPEN_CASE, listener)
      if (!hadWindow) delete runtime.window
    }
    expect(seen).toEqual([{ caseId: 'coffee-market', sessionId: 's1' }])
    expect(readFileSync(join(import.meta.dir, 'SentOfficeCase.tsx'), 'utf8')).toContain('onClick={() => openSentOfficeCase(item.id, sessionId)}')
  })

  it('the chat bubble shows the stored case and re-renders when it changes', () => {
    const source = readFileSync(join(import.meta.dir, '../app-shell/ChatDisplay.tsx'), 'utf8')
    expect(source).toContain('<SentOfficeCase office={message.turnContext?.office} sessionId={sessionId} />')
    expect(source).toContain('prev.message.turnContext?.office === next.message.turnContext?.office')
  })
})
