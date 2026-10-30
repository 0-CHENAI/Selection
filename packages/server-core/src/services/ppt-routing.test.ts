import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildPptPrompt } from './ppt-catalog'
import { buildPptRevisionPrompt, buildPptTurnPrompt, validatePptRevision } from './ppt-live'

const root = resolve(import.meta.dir, '../../../../apps/electron/resources/skills/ppt-design')
const sessions: string[] = []
function session(file = 'deck.json'): string {
  const path = mkdtempSync(join(tmpdir(), 'ppt-routing-'))
  sessions.push(path)
  mkdirSync(join(path, 'data'))
  writeFileSync(join(path, 'data', file), '{}')
  return path
}
afterEach(() => { for (const path of sessions.splice(0)) rmSync(path, { recursive: true, force: true }) })

// These are host-context contract tests, not evidence of a model choosing/executing a tool.
test('title edit follow-up does not inject generation or the inherited locked design', () => {
  const path = session()
  const prompt = buildPptPrompt({ templateId: 'dsh-cartesian' }, path, root, [], '只把第 2 页标题改短，保留母版')
  expect(prompt).toContain('<ppt_follow_up_context>')
  expect(prompt).toContain('office_edit: change text/title')
  expect(prompt).toContain('do not regenerate it from deck.json or relock style')
  expect(prompt).not.toContain('<ppt_generation_context>')
  expect(prompt).not.toContain('Selected design.md:')
  expect(prompt).not.toContain('Write the working deck')
  expect(readFileSync(join(path, 'data/deck.json'), 'utf8')).toBe('{}')
})

test('two-page revision preserves scope and leaves style locked', () => {
  const revision = validatePptRevision({ targets: [{ page: 2 }, { page: 3 }], comment: '只调整这两页版式' }, root)
  const prompt = buildPptRevisionPrompt(revision, session())
  expect(prompt).toContain('deck_revision: change layout, narrative or page order')
  expect(prompt).toContain('Rewrite only these targets: page 2; page 3.')
  expect(prompt).toContain('Keep every other page identical')
  expect(prompt).toContain('Do not relock style')
  expect(prompt).not.toContain('Restyle and reflow the whole deck using template')
  expect(prompt).toContain('For office_edit, edit only the delivered PPTX')
})

test('explicit restyle is labelled, while recolor preserves structure', () => {
  const path = session()
  const restyle = buildPptRevisionPrompt(validatePptRevision({ action: 'restyle', targets: [], templateId: 'dsh-cartesian' }, root), path)
  expect(restyle).toContain('Route: restyle (explicit UI action). Restyle and reflow')
  const recolor = buildPptRevisionPrompt(validatePptRevision({ action: 'recolor', targets: [], themeId: 'academic-ink' }, root), path)
  expect(recolor).toContain('Route: deck_revision (explicit recolor action; token changes only)')
  expect(recolor).toContain('Keep the layout, copy, page count, and charts')
  expect(recolor).not.toContain('Restyle and reflow the whole deck using template')
})

test('existing output without project cannot trigger silent reconstruction; new logo stays available', () => {
  const path = session('ppt-output.json')
  const prompt = buildPptPrompt({ logo: { name: '新标志.png', mimeType: 'image/png', base64: Buffer.from('new logo').toString('base64') } }, path, root)
  expect(prompt).toContain('A missing or malformed project is not permission to start over')
  expect(prompt).toContain('external PPTX without a matching deck project')
  expect(prompt).toContain(join(path, 'attachments/ppt-brand/logo.png'))
  expect(readFileSync(join(path, 'attachments/ppt-brand/logo.png'), 'utf8')).toBe('new logo')
  expect(prompt).toContain('New attachments remain source material')
})

test('fresh session still receives generation references', () => {
  const path = session()
  rmSync(join(path, 'data/deck.json'))
  const prompt = buildPptPrompt({ templateId: 'dsh-cartesian' }, path, root)
  expect(prompt).toContain('<ppt_generation_context>')
  expect(prompt).toContain('Selected design.md:')
})

test('session turn gives revision precedence over persisted generation preferences', () => {
  const path = session()
  const prompt = buildPptTurnPrompt({ ppt: { templateId: 'dsh-cartesian' }, pptRevision: { action: 'revise', targets: [{ page: 2 }], comment: '改标题' } }, path, root)!
  expect(prompt).toContain('<ppt_revision>')
  expect(prompt).not.toContain('<ppt_generation_context>')
  expect(prompt).not.toContain('<ppt_follow_up_context>')
  expect(prompt).not.toContain('Selected design.md:')
  expect(buildPptTurnPrompt(undefined, path, root)).toBeUndefined()
})
