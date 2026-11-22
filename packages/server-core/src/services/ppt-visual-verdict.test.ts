import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { PptVisualTurn, pptVisualBlock, readVisualVerdict, recordVisualVerdict, visualSha256, type PptVisualRender } from './ppt-visual-verdict'

const ns = 'http://schemas.openxmlformats.org'
function visualTestPptx(second = '<slide/>'): Uint8Array {
  return zipSync({
    'ppt/presentation.xml': strToU8(`<p:presentation xmlns:p="${ns}/presentationml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r1"/><p:sldId r:id="r2"/></p:sldIdLst></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(`<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>`),
    'ppt/slides/slide1.xml': strToU8('<slide/>'),
    'ppt/slides/slide2.xml': strToU8(second),
  })
}

describe('G4 outcome bound to the final PowerPoint', () => {
  let root: string
  let path: string
  let render: PptVisualRender
  const pass = { coveredPages: [1, 2], verdict: 'pass', findings: [] } as const
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-ppt-verdict-'))
    path = join(root, 'test.pptx')
    writeFileSync(path, visualTestPptx())
    const pages = [1, 2].map(page => {
      const path = join(root, `slide-${page}.png`)
      const image = strToU8(`screenshot ${page}`)
      writeFileSync(path, image)
      return { page, path, sha256: visualSha256(image) }
    })
    render = { path, sha256: visualSha256(readFileSync(path)), pages }
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('requires a real recorded result, not screenshot presence', () => {
    expect(pptVisualBlock(root, path)).toEqual({ reason: 'missing' })
    const visual = new PptVisualTurn()
    visual.addRender(render)
    expect(visual.directReview(JSON.stringify({ path, ...pass }))).toBeUndefined()
  })

  it('accepts the structured result of the existing image reviewer', () => {
    const visual = new PptVisualTurn()
    visual.addRender(render)
    visual.beginReview('review', { pptReview: { path, pages: [1, 2] }, attachments: render.pages.map(image => image.path) })
    const result = visual.finishReview('review', JSON.stringify(pass))!
    recordVisualVerdict(root, result.render, result.verdict)
    expect(pptVisualBlock(root, path)).toBeUndefined()
  })

  it('reports failed pages and cannot be overridden by a pass on the same bytes', () => {
    const finding = { page: 2, issue: 'The header does not align with the table.' }
    const review = readVisualVerdict(JSON.stringify({ ...pass, findings: [finding] }))!
    recordVisualVerdict(root, render, review)
    recordVisualVerdict(root, render, readVisualVerdict(JSON.stringify(pass))!)
    expect(pptVisualBlock(root, path)).toEqual({ reason: 'failed', pages: [2], findings: [finding] })
  })

  it('invalidates an earlier pass after the deck changes', () => {
    recordVisualVerdict(root, render, readVisualVerdict(JSON.stringify(pass))!)
    writeFileSync(path, visualTestPptx('<slide>changed</slide>'))
    expect(pptVisualBlock(root, path)).toEqual({ reason: 'stale' })
  })

  it('does not accept a partial review for a new deck', () => {
    recordVisualVerdict(root, { ...render, pages: [render.pages[0]!] }, { coveredPages: [1], verdict: 'pass', findings: [] })
    expect(pptVisualBlock(root, path)).toEqual({ reason: 'coverage', pages: [2] })
  })

  it('keeps existing affected-page coverage for a proven local edit', () => {
    recordVisualVerdict(root, render, readVisualVerdict(JSON.stringify(pass))!)
    writeFileSync(path, visualTestPptx('<slide>changed</slide>'))
    recordVisualVerdict(root, { ...render, sha256: visualSha256(readFileSync(path)), pages: [render.pages[1]!] },
      { coveredPages: [2], verdict: 'pass', findings: [] }, true)
    expect(pptVisualBlock(root, path)).toBeUndefined()
  })

  it('supports the desktop model recording images already returned by office_render', () => {
    const visual = new PptVisualTurn()
    for (const image of render.pages) visual.addRender({ ...render, pages: [image] }, true)
    const result = visual.directReview(JSON.stringify({ path, ...pass }))!
    recordVisualVerdict(root, result.render, result.verdict)
    expect(pptVisualBlock(root, path)).toBeUndefined()
  })
})
