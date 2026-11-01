import { beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, createStore } from 'jotai'
import { officeComposerAtomFamily } from '@/atoms/office'
import sharp from 'sharp'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { OfficeCaseGallery } from './OfficeCaseGallery'
import { OfficeModeSwitcher } from './OfficeModeSwitcher'
import {
  casesForOfficeHome,
  nextOfficeSection,
  officeSessionRoute,
  readOfficeSection,
  rememberOfficeSection,
  resolveOfficeDraftRequest,
} from './office-home'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
})

describe('office home', () => {
  it('keeps PPT, Word, Excel in that order and moves with arrow keys', () => {
    expect(nextOfficeSection('ppt', 'ArrowRight')).toBe('word')
    expect(nextOfficeSection('word', 'ArrowRight')).toBe('excel')
    expect(nextOfficeSection('excel', 'ArrowLeft')).toBe('word')
    expect(nextOfficeSection('word', 'Home')).toBe('ppt')
    expect(nextOfficeSection('ppt', 'End')).toBe('excel')
    expect(nextOfficeSection('ppt', 'Enter')).toBeNull()
  })

  it('shows the four curated Word cases and every registered Excel case', () => {
    const cases = (catalog as { cases: Array<{ id: string; mode: string; category?: string }> }).cases
    expect(casesForOfficeHome(cases, 'word').map(item => item.id)).toEqual([
      'meeting-minutes',
      'coffee-market',
      'equity-research',
      'government-notice',
    ])
    expect(casesForOfficeHome(cases, 'excel').map(item => item.id)).toEqual([
      'execution-tracker',
      'annual-business',
      'port-cargo',
      'bio-assay',
    ])
  })

  it('carries the picked case into the draft and falls back to the section mode', () => {
    expect(resolveOfficeDraftRequest('ppt', { mode: 'word', templateId: 'meeting-minutes', revision: '1' })).toBeUndefined()
    expect(resolveOfficeDraftRequest('word', null)).toEqual({ mode: 'word' })
    expect(resolveOfficeDraftRequest('excel', { mode: 'excel', templateId: 'annual-business', revision: '20260914.1' })).toEqual({
      mode: 'excel',
      templateId: 'annual-business',
      revision: '20260914.1',
    })
  })

  it('opens each session on its own office route', () => {
    expect(officeSessionRoute({ id: 'a', ppt: {} })).toBe('ppt/session/a')
    expect(officeSessionRoute({ id: 'b', office: { mode: 'word' } })).toBe('office/word/session/b')
    expect(officeSessionRoute({ id: 'c', office: { mode: 'excel' } })).toBe('office/excel/session/c')
  })

  it('remembers the last section in this window and defaults to PPT', () => {
    rememberOfficeSection('ppt')
    expect(readOfficeSection()).toBe('ppt')
    rememberOfficeSection('excel')
    expect(readOfficeSection()).toBe('excel')
    rememberOfficeSection('ppt')
  })

  it('renders a radiogroup in PPT, Word, Excel order with the host selected style', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <OfficeModeSwitcher section="word" onChange={() => {}} />
      </I18nextProvider>,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html.indexOf('>PPT<')).toBeLessThan(html.indexOf('>Word<'))
    expect(html.indexOf('>Word<')).toBeLessThan(html.indexOf('>Excel<'))
    expect(html).toContain('data-testid="office-mode-word"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('h-7')
    expect(html).toContain('rounded-[8px]')
    expect(html).toContain('bg-accent/10')
    expect(html).toContain('motion-reduce:transition-none')
    const source = readFileSync(join(import.meta.dir, 'OfficeModeSwitcher.tsx'), 'utf8')
    expect(source).toContain("role=\"radiogroup\"")
    expect(source).toContain('nextOfficeSection')
  })

  it('shows a static first-page or first-sheet cover on every home card', async () => {
    const shell = readFileSync(join(import.meta.dir, '../app-shell/AppShell.tsx'), 'utf8')
    expect(shell).toContain('icon: OfficeIcon')
    expect(shell).not.toContain('icon: Presentation')
    const covers = join(import.meta.dir, '../../assets/office-covers')
    for (const mode of ['word', 'excel'] as const) {
      const html = renderToStaticMarkup(
        <Provider>
          <I18nextProvider i18n={i18n}>
            <OfficeCaseGallery mode={mode} composerKey="cover-test" />
          </I18nextProvider>
        </Provider>,
      )
      const items = casesForOfficeHome((catalog as { cases: Array<{ id: string; mode: string; category?: string }> }).cases, mode)
      expect(html).toContain('aspect-video')
      expect(html).toContain('rounded-[8px]')
      expect(html).toContain('object-cover')
      for (const item of items) {
        expect(html).toContain(`data-testid="office-case-${item.id}"`)
        expect(html).toContain(`${item.id}.webp`)
        const file = join(covers, `${item.id}.webp`)
        expect(existsSync(file)).toBe(true)
        const { width, height } = await sharp(file).metadata()
        expect(width).toBe(1280)
        expect(height).toBe(720)
        const stats = await sharp(file).stats()
        const stddev = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) / stats.channels.length
        expect(stddev).toBeGreaterThan(8)
      }
    }
  })

  it('clicking a case card attaches it to the composer as a chip and clicking again detaches it; nothing is prefilled', async () => {
    const { toggleOfficeCase } = await import('./OfficeCaseGallery')
    const research = { id: 'equity-research', revision: '1' }
    const attached = toggleOfficeCase(null, 'word', research)
    expect(attached).toEqual({ mode: 'word', templateId: 'equity-research', revision: '1' })
    expect(toggleOfficeCase({ mode: 'word', templateId: 'meeting-minutes' }, 'word', research)).toEqual(attached)
    expect(toggleOfficeCase(attached, 'word', research)).toEqual({ mode: 'word' })
    // The picked case goes out with the draft as the session's Office case.
    expect(resolveOfficeDraftRequest('word', attached)).toEqual(attached)

    const { OfficeSelectedCase, attachedOfficeCase } = await import('./OfficeSelectedCase')
    expect(attachedOfficeCase(attached)?.title).toBe('小米汽车研究报告')
    expect(attachedOfficeCase({ mode: 'word' })).toBeUndefined()
    expect(attachedOfficeCase({ mode: 'excel', templateId: 'equity-research' })).toBeUndefined()
    const store = createStore()
    store.set(officeComposerAtomFamily('chip-test'), attached)
    const chip = renderToStaticMarkup(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <OfficeSelectedCase composerKey="chip-test" />
        </I18nextProvider>
      </Provider>,
    )
    expect(chip).toContain('data-testid="office-selected-case"')
    expect(chip).toContain('aria-label="已附上案例：小米汽车研究报告"')
    expect(chip).toContain('equity-research.webp')
    expect(chip).toContain('aria-label="移除案例：小米汽车研究报告"')
    expect(renderToStaticMarkup(<Provider><I18nextProvider i18n={i18n}><OfficeSelectedCase composerKey="empty" /></I18nextProvider></Provider>)).toBe('')

    // No 做同款 button and no prompt prefill left anywhere on the card or in the composer.
    const html = renderToStaticMarkup(
      <Provider>
        <I18nextProvider i18n={i18n}>
          <OfficeCaseGallery mode="word" composerKey="card-click" />
        </I18nextProvider>
      </Provider>,
    )
    expect(html).not.toContain('office-case-same-')
    expect(html).not.toContain('做同款')
    expect(html).toContain('<button type="button" data-testid="office-case-equity-research" aria-pressed="false"')
    const source = readFileSync(join(import.meta.dir, 'OfficeCaseGallery.tsx'), 'utf8')
    expect(source).toContain('onClick={() => setRequest(previous => toggleOfficeCase(previous, mode, item))}')
    expect(source).not.toContain('craft:insert-text')
    const input = readFileSync(join(import.meta.dir, '../app-shell/input/FreeFormInput.tsx'), 'utf8')
    expect(input).toContain('hasOfficeCase={!!attachedOfficeCase(officeCase)}')
    expect(input).not.toContain('e.detail.compose')
  })

  it('「预览」 opens the sample without counting as a card click', async () => {
    const { previewOfficeCase } = await import('./OfficeCaseGallery')
    const { OFFICE_PREVIEW_OPEN_CASE } = await import('@/lib/office-preview-page')
    const opened: unknown[] = []
    const inserted: unknown[] = []
    let stopped = false
    const runtime = globalThis as { window?: unknown }
    const hadWindow = 'window' in runtime
    if (!hadWindow) runtime.window = new EventTarget()
    const bus = runtime.window as EventTarget
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail)
    const onInsert = (event: Event) => inserted.push((event as CustomEvent).detail)
    bus.addEventListener(OFFICE_PREVIEW_OPEN_CASE, onOpen)
    bus.addEventListener('craft:insert-text', onInsert)
    try {
      previewOfficeCase({ stopPropagation: () => { stopped = true } }, 'coffee-market')
    } finally {
      bus.removeEventListener(OFFICE_PREVIEW_OPEN_CASE, onOpen)
      bus.removeEventListener('craft:insert-text', onInsert)
      if (!hadWindow) delete runtime.window
    }
    expect(inserted).toEqual([])
    expect(stopped).toBe(true)
    expect(opened).toEqual([{ caseId: 'coffee-market' }])
    const source = readFileSync(join(import.meta.dir, 'OfficeCaseGallery.tsx'), 'utf8')
    expect(source).toContain('onClick={event => previewOfficeCase(event, item.id)}')
  })

  it('Word / Excel cards with a sample file get a keyboard-reachable 「预览」 button; file-less cases do not', async () => {
    const { hasOfficeCaseSample } = await import('./OfficeCaseGallery')
    const render = (mode: 'word' | 'excel') => renderToStaticMarkup(
      <Provider>
        <I18nextProvider i18n={i18n}>
          <OfficeCaseGallery mode={mode} composerKey={`preview-${mode}`} />
        </I18nextProvider>
      </Provider>,
    )
    const word = render('word'), excel = render('excel')
    for (const id of ['meeting-minutes', 'coffee-market', 'equity-research', 'government-notice']) expect(word).toContain(`data-testid="office-case-preview-${id}"`)
    for (const id of ['annual-business', 'port-cargo', 'bio-assay']) expect(excel).toContain(`data-testid="office-case-preview-${id}"`)
    expect(excel).not.toContain('data-testid="office-case-preview-execution-tracker"')
    expect(word).toContain('aria-label="预览样例：中国现制咖啡市场调研报告"')
    expect(word).toContain('group-focus-within/case:opacity-100')
    expect(hasOfficeCaseSample({ sampleFile: 'example.xlsx' })).toBe(true)
    expect(hasOfficeCaseSample({ sampleFile: null })).toBe(false)
    expect(hasOfficeCaseSample({ sampleFile: 'deck.pptx' })).toBe(false)
  })

  it('a chat started from a case keeps a preview entry above the composer', async () => {
    const { OfficeSessionCase, officeSessionCase } = await import('./OfficeSessionCase')
    expect(officeSessionCase({ mode: 'excel', templateId: 'port-cargo' })?.title).toBeTruthy()
    expect(officeSessionCase({ mode: 'word', templateId: 'port-cargo' })).toBeUndefined()
    expect(officeSessionCase({ mode: 'word', templateId: 'selection-work-notice' })).toBeUndefined()
    expect(officeSessionCase({ mode: 'word' })).toBeUndefined()
    expect(officeSessionCase(null)).toBeUndefined()
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <OfficeSessionCase sessionId="s1" office={{ mode: 'word', templateId: 'government-notice' }} />
      </I18nextProvider>,
    )
    expect(html).toContain('data-testid="office-session-case-preview-government-notice"')
    expect(html).toContain('>预览<')
    expect(renderToStaticMarkup(<I18nextProvider i18n={i18n}><OfficeSessionCase sessionId="s1" office={{ mode: 'ppt' }} /></I18nextProvider>)).toBe('')
  })
})

