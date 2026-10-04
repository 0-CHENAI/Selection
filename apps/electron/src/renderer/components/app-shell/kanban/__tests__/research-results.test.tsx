import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchResults } from '../ResearchResults'
import { researchPreview } from '../../../../playground/registry/research-preview'

test('ordinary results do not render a research section; current conclusions retain review/version linkage', () => {
  expect(renderToStaticMarkup(<ResearchResults />)).toBe('')
  const markup = renderToStaticMarkup(<ResearchResults research={researchPreview().summary} />)
  expect(markup).toContain('cost@2')
  expect(markup).toContain('100 万元（1000000 元）')
  expect(markup).toContain('risk')
  expect(markup).toContain('preview-session-review-cost')
  expect(markup).toContain('preview-active')
  expect(markup).toContain('wrong-cost')
  expect(markup).toContain('cost-e1')
  expect(markup).toContain('preview-source-sha256')
})
