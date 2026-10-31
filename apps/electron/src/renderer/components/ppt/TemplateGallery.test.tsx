import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PptTemplate } from '@craft-agent/shared/protocol'
import { TemplateGrid } from './TemplateGallery'
import { TemplateOptions } from './TemplateOptions'

const variants = [
  { id: 'dsh-signal', title: '信号简报', cover: 'data:variant-1', referencePages: [] },
  { id: 'dsh-monochrome', title: '极简研究', cover: 'data:variant-2', referencePages: [] },
]
const template: PptTemplate = { id: 'rational-brief', title: '理性简报', category: '商务', tier: 'default', canvas: '16:9', pages: 12, cover: 'data:cover', referencePages: [], variants } as PptTemplate

test('template cards show cover, title and category · pages without variant chips', () => {
  const html = renderToStaticMarkup(<TemplateGrid templates={[template]} compact={false} onSelect={() => {}} onPreview={() => {}} />)
  expect(html).toContain('理性简报')
  expect(html).toContain('data:cover')
  expect(html).not.toContain('ppt-template-variants')
  expect(html).not.toContain('ppt-variant-')
  expect(html).not.toContain('信号简报')
  expect(html).not.toContain('极简研究')
})

test('a selected variant still marks its parent card as selected', () => {
  const html = renderToStaticMarkup(<TemplateGrid templates={[template]} compact={false} selectedId="dsh-signal" onSelect={() => {}} onPreview={() => {}} />)
  expect(html).toContain('aria-pressed="true"')
})

test('variants stay selectable from the selected template options', () => {
  const html = renderToStaticMarkup(<TemplateOptions request={{ templateId: 'rational-brief' } as never} themes={[]} variants={variants} baseTemplate={{ id: template.id, title: template.title }} onChange={() => {}} />)
  expect(html).toContain('理性简报')
  expect(html).toContain('信号简报')
  expect(html).toContain('极简研究')
})
