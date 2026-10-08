import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchResults } from '../ResearchResults'
import { researchPreview, researchLinesPreview, researchJudgmentPreview } from '../../../../playground/registry/research-preview'

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

test('conditional results preserve both premises, exact parent references and shared task',()=>{
  const summary=researchLinesPreview().summary
  expect(summary.blockers).toEqual([])
  const markup=renderToStaticMarkup(<ResearchResults research={summary} />)
  for(const value of ['9000','1000','recommend-high@1','recommend-low@1','Q-price','price','market-high','market-low','2025','含税','实测运行时长'])expect(markup).toContain(value)
})

test('B2/B4 stages show independent premise critique and falsification alongside original source history', () => {
  const summary = researchJudgmentPreview().summary
  expect(summary.blockers).toEqual([])
  expect(summary.judgment!.stages[0]!.state).toBe('deliverable')
  const markup = renderToStaticMarkup(<ResearchResults research={summary} />)
  expect(markup).toContain('cost@2')
  expect(markup).toContain('两年口径成立，测试资料不能推出真实市场成本。')
  expect(markup).toContain('更正后的原文金额或统计期间与当前结论矛盾。')
  expect(markup).toContain('preview-session-review-cost')
})
