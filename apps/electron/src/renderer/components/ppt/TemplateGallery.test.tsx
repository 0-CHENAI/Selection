import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { PptTemplate } from '@craft-agent/shared/protocol'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { TemplateGrid } from './TemplateGallery'
import { TemplateOptions } from './TemplateOptions'

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } }, interpolation: { escapeValue: false } })

function render(node: ReactElement): string {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

const variants = [
  { id: 'dsh-signal', title: '信号简报', cover: 'data:variant-1', referencePages: [] },
  { id: 'dsh-monochrome', title: '极简研究', cover: 'data:variant-2', referencePages: [] },
]
const template: PptTemplate = { id: 'rational-brief', title: '理性简报', category: '商务', tier: 'default', canvas: '16:9', pages: 12, cover: 'data:cover', referencePages: [], variants } as PptTemplate

test('template cards show cover, title and category · pages without variant chips', () => {
  const html = render(<TemplateGrid templates={[template]} compact={false} onSelect={() => {}} onPreview={() => {}} />)
  expect(html).toContain('理性简报')
  expect(html).toContain('data:cover')
  expect(html).not.toContain('ppt-template-variants')
  expect(html).not.toContain('ppt-variant-')
  expect(html).not.toContain('信号简报')
  expect(html).not.toContain('极简研究')
})

test('a personal template card shows conversion counts and hides the english id', () => {
  const custom: PptTemplate = {
    id: 'custom-0123456789abcdef',
    title: '公司模板',
    category: '自定义',
    canvas: '16:9',
    pages: 10,
    cover: 'data:cover',
    referencePages: [],
    diagnostics: { faithful: 8, approximate: 1, retained: 0, unsupported: 1 },
  }
  const html = render(<TemplateGrid templates={[custom]} compact={false} onSelect={() => {}} onPreview={() => {}} onChanged={() => {}} />)
  expect(html).toContain('公司模板')
  expect(html).toContain('保真 8')
  expect(html).toContain('近似 1')
  expect(html).toContain('不支持 1')
  expect(html).toContain('有对象需要人工复核')
  expect(html).not.toContain('>custom-0123456789abcdef<')
  expect(html).not.toContain('ppt-template-variants')
})

test('a selected variant still marks its parent card as selected', () => {
  const html = render(<TemplateGrid templates={[template]} compact={false} selectedId="dsh-signal" onSelect={() => {}} onPreview={() => {}} />)
  expect(html).toContain('aria-pressed="true"')
})

test('variants stay selectable from the selected template options', () => {
  const html = render(<TemplateOptions request={{ templateId: 'rational-brief' } as never} themes={[]} variants={variants} baseTemplate={{ id: template.id, title: template.title }} onChange={() => {}} />)
  expect(html).toContain('理性简报')
  expect(html).toContain('信号简报')
  expect(html).toContain('极简研究')
})
