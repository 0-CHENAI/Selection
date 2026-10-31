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
})
