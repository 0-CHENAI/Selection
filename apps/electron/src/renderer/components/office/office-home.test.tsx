import { beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider } from 'jotai'
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
  sameStyleDraft,
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

  it('「做同款」 fills the catalog prompt and selects the first 【…】 placeholder without sending', () => {
    const cases = (catalog as { cases: Array<{ id: string; prompt?: string }> }).cases
    const research = cases.find(item => item.id === 'equity-research')!.prompt!
    const draft = sameStyleDraft(research)!
    expect(draft.text).toBe(research)
    expect(draft.text.slice(draft.selection.start, draft.selection.end)).toBe('【公司或行业】')
    // What the person already typed stays above the prompt.
    const kept = sameStyleDraft(research, '先看 2025 年数据  ')!
    expect(kept.text.startsWith('先看 2025 年数据\n\n')).toBe(true)
    expect(kept.text.slice(kept.selection.start, kept.selection.end)).toBe('【公司或行业】')
    // No placeholder: caret goes to the end.
    const minutes = sameStyleDraft(cases.find(item => item.id === 'meeting-minutes')!.prompt)!
    expect(minutes.selection).toEqual({ start: minutes.text.length, end: minutes.text.length })
    // Cases without a catalog prompt leave the draft alone.
    expect(sameStyleDraft(undefined, 'typed')).toBeNull()
    expect(sameStyleDraft('  ')).toBeNull()
  })

  it('each case card has a keyboard-reachable 做同款 button that selects the case and inserts the prompt', async () => {
    const html = renderToStaticMarkup(
      <Provider>
        <I18nextProvider i18n={i18n}>
          <OfficeCaseGallery mode="word" composerKey="same-style" sessionId="s1" />
        </I18nextProvider>
      </Provider>,
    )
    expect(html).toContain('data-testid="office-case-same-equity-research"')
    expect(html).toContain('aria-label="做同款：小米汽车研究报告"')
    expect(html).toContain('focus-visible:opacity-100')
    expect(html).toContain('[@media(hover:none)]:opacity-100')
    const { fillSameStylePrompt } = await import('./OfficeCaseGallery')
    const seen: unknown[] = []
    const runtime = globalThis as { window?: unknown }
    const hadWindow = 'window' in runtime
    const target = new EventTarget()
    if (!hadWindow) runtime.window = target
    const bus = runtime.window as EventTarget
    const listener = (event: Event) => seen.push((event as CustomEvent).detail)
    bus.addEventListener('craft:insert-text', listener)
    try {
      fillSameStylePrompt({ prompt: '帮我研究【公司或行业】。' }, 's1')
    } finally {
      bus.removeEventListener('craft:insert-text', listener)
      if (!hadWindow) delete runtime.window
    }
    const detail = seen[0] as { sessionId: string; compose: (current: string) => unknown }
    expect(detail.sessionId).toBe('s1')
    expect(detail.compose('')).toEqual({ text: '帮我研究【公司或行业】。', selection: { start: 4, end: 11 } })
  })
})
