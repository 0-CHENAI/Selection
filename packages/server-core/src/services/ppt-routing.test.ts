import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PptRevision, PptRun, SendMessageOptions } from '@craft-agent/shared/protocol'
import { buildPptPrompt, hasPptContext, pptSendOptions } from './ppt-catalog'
import { buildPptRevisionPrompt, buildPptTurnPrompt, pptTurnRun, readPptProgress, validatePptRevision, writePptRun } from './ppt-live'

const root = resolve(import.meta.dir, '../../../../apps/electron/resources/skills/ppt-design')
const sessions: string[] = []
function session(file: string | null = 'deck.json'): string {
  const path = mkdtempSync(join(tmpdir(), 'ppt-routing-'))
  sessions.push(path)
  mkdirSync(join(path, 'data'))
  if (file) writeFileSync(join(path, 'data', file), '{}')
  return path
}
afterEach(() => { for (const path of sessions.splice(0)) rmSync(path, { recursive: true, force: true }) })

const storedPpt = { templateId: 'dsh-cartesian', themeId: 'academic-ink' }

test('ordinary follow-ups cannot reset the style chosen by a prior UI action', () => {
  const path = session()
  writeFileSync(join(path, 'existing.pptx'), 'direct OfficeCLI edit')
  writePptRun(path, { action: 'restyle', templateId: 'dsh-course-workshop' })
  writePptRun(path, { action: 'recolor', themeId: 'keynote-stage' })
  const options = pptSendOptions('PRO', storedPpt, undefined, root)
  const run = pptTurnRun(options, path)!
  expect(run).toEqual({ action: 'revise' })
  writePptRun(path, run)
  expect(readPptProgress(path, true)).toMatchObject({
    templateId: 'dsh-course-workshop',
    themeId: 'keynote-stage',
    run: { action: 'revise' },
  })
  expect(readFileSync(join(path, 'existing.pptx'), 'utf8')).toBe('direct OfficeCLI edit')
})

test('only fresh generation applies persisted composer template and theme choices', () => {
  const path = session(null)
  expect(hasPptContext(path)).toBe(false)
  expect(pptTurnRun({ ppt: storedPpt }, path)).toEqual({ action: 'generate', ...storedPpt })
  expect(pptTurnRun(undefined, path)).toBeUndefined()
  for (const file of ['deck.json', 'ppt-output.json']) {
    writeFileSync(join(path, 'data', file), '{partial')
    expect(hasPptContext(path)).toBe(true)
    expect(pptTurnRun({ ppt: storedPpt }, path)).toEqual({ action: 'revise' })
    rmSync(join(path, 'data', file))
  }
})

test('explicit revision action takes precedence and carries only its own style change', () => {
  const path = session(null)
  const cases: Array<{ revision: PptRevision; run: PptRun }> = [
    { revision: { targets: [{ page: 2 }], templateId: 'dsh-course-workshop', themeId: 'keynote-stage' }, run: { action: 'revise' } },
    { revision: { action: 'restyle', targets: [], templateId: 'dsh-course-workshop', themeId: 'keynote-stage' }, run: { action: 'restyle', templateId: 'dsh-course-workshop' } },
    { revision: { action: 'recolor', targets: [], themeId: 'keynote-stage', templateId: 'dsh-course-workshop' }, run: { action: 'recolor', themeId: 'keynote-stage' } },
  ]
  for (const { revision, run } of cases) {
    const options: SendMessageOptions = { ppt: storedPpt, pptRevision: validatePptRevision(revision, root) }
    expect(pptTurnRun(options, path)).toEqual(run)
  }
})

test('revision prompt precedence skips generation side effects even with retained preferences', () => {
  const path = session()
  const revision = validatePptRevision({ targets: [{ page: 2 }, { page: 3, elementId: 'title' }], comment: '只改这两页' }, root)
  const options = { ppt: { ...storedPpt, logo: { name: 'logo.png', mimeType: 'image/png', base64: Buffer.from('logo').toString('base64') } }, pptRevision: revision }
  expect(buildPptTurnPrompt(options, path, root)).toBe(buildPptRevisionPrompt(revision, path))
  expect(existsSync(join(path, 'attachments/ppt-brand/logo.png'))).toBe(false)
  expect(existsSync(join(path, 'data/chart-fallback.json'))).toBe(false)
  expect(readFileSync(join(path, 'data/deck.json'), 'utf8')).toBe('{}')
  expect(revision.targets).toEqual([{ page: 2 }, { page: 3, elementId: 'title' }])
  expect(buildPptTurnPrompt(undefined, path, root)).toBeUndefined()
})

test('output-only follow-ups retain new source material without touching the delivered file', () => {
  const path = session('ppt-output.json')
  const output = join(path, 'existing.pptx')
  writeFileSync(output, 'KEEP')
  writeFileSync(join(path, 'data/ppt-output.json'), JSON.stringify({ path: output, stamp: 'prior' }))
  const request = { logo: { name: '新标志.png', mimeType: 'image/png', base64: Buffer.from('new logo').toString('base64') } }
  expect(buildPptTurnPrompt({ ppt: request }, path, root)).toBe(buildPptPrompt(request, path, root))
  expect(readFileSync(join(path, 'attachments/ppt-brand/logo.png'), 'utf8')).toBe('new logo')
  expect(readFileSync(output, 'utf8')).toBe('KEEP')
  expect(existsSync(join(path, 'data/deck.json'))).toBe(false)
})

test('follow-up charts do not apply inherited generation colors over the saved deck', () => {
  const path = session()
  const request = { ...storedPpt, brandColor: '#123456' }
  const skills = [{ slug: 'sample-charts', metadata: { name: 'Sample Charts', description: 'Chart with a custom palette' }, content: 'Return SVG with a custom palette.' }]
  const message = '用 sample-charts 给第 2 页添加图表'
  const prompt = buildPptPrompt(request, path, root, skills, message)
  // Preferences may be listed as reference data, but must not also feed chart styling.
  const preferences = JSON.stringify({ templateId: request.templateId, themeId: request.themeId, brandColor: request.brandColor })
  expect(prompt.replace(preferences, '')).not.toContain(request.brandColor)
  const theme = JSON.parse(readFileSync(join(root, 'styles/themes', `${request.themeId}.json`), 'utf8'))
  expect(prompt).not.toContain(JSON.stringify(theme.colors))
  const fresh = buildPptPrompt(request, session(null), root, skills, message)
  expect(fresh).toContain(JSON.stringify({ ...theme.colors, accent: request.brandColor }))
})

test('revision validation snapshots targets and drops unrelated composer style fields', () => {
  const targets = [{ page: 2, elementId: 'title' }, { page: 4 }]
  const revision = validatePptRevision({ action: 'revise', targets, templateId: 'dsh-cartesian', themeId: 'academic-ink', comment: '改标题' }, root)
  targets[0]!.page = 10
  targets.push({ page: 5 })
  expect(revision).toEqual({ action: 'revise', targets: [{ page: 2, elementId: 'title' }, { page: 4 }], comment: '改标题' })
})

test('an authorized active PPTX uses existing context without requiring a saved deck project', () => {
  const path = session(null)
  const presentation = join(path, 'external.PPTX')
  writeFileSync(presentation, 'KEEP')
  const options = { ppt: storedPpt }
  expect(hasPptContext(path, presentation)).toBe(true)
  expect(pptTurnRun(options, path, presentation)).toEqual({ action: 'revise' })
  const prompt = buildPptTurnPrompt(options, path, root, [], '只改标题', presentation)!
  expect(prompt).not.toContain('<ppt_generation_context>')
  expect(prompt).toContain(JSON.stringify(presentation))
  expect(readFileSync(presentation, 'utf8')).toBe('KEEP')
  expect(existsSync(join(path, 'data/deck.json'))).toBe(false)
  expect(pptTurnRun(options, path, join(path, 'source.xlsx'))).toEqual({ action: 'generate', ...storedPpt })
  expect(buildPptTurnPrompt(options, path, root, [], '新建演示稿', join(path, 'source.xlsx'))).toContain('<ppt_generation_context>')
})
