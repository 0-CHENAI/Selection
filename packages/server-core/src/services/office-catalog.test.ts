import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OFFICE_FORMAT_UPDATED, OFFICE_REQUEST_MAX_BYTES, type OfficeDocumentState } from '@craft-agent/shared/protocol/office'
import { filterUserFacingSkills, loadAllSkills, loadSkillBySlug, toSkillCatalogEntries } from '@craft-agent/shared/skills'
import { pptSendOptions } from './ppt-catalog'
import {
  authoringSkillForMode,
  buildOfficeInjection,
  executeOfficeTemplates,
  listOfficeTemplates,
  officeAttachmentsKeepTemplate,
  officeFingerprint,
  officeTemplatePreview,
  officeUserMaterialNote,
  planOfficeTurn,
  preserveOfficeInjection,
  projectOfficeModelContext,
  type OfficeTranscriptMessage,
} from './office-catalog'
import { getOfficeRenderCapabilities, officeRenderPreview, officeRenderRecalc, resolveOfficeRenderPlan, setOfficeRenderCapabilities, setOfficeRenderHosts } from './office-render'

const wordCaseIds = ['meeting-minutes', 'coffee-market', 'equity-research', 'government-notice', 'selection-meeting-minutes', 'selection-work-notice', 'execution-tracker']

function activeText(messages: readonly OfficeTranscriptMessage[]): string {
  return projectOfficeModelContext(messages.filter(message => message.officeInjection?.status !== 'replaced' || message.content === OFFICE_FORMAT_UPDATED))
}

describe('office document mode', () => {
  test('M1: Word + meeting-minutes injects once across five turns', () => {
    const templates = listOfficeTemplates()
    let messages: OfficeTranscriptMessage[] = []
    let office: OfficeDocumentState = { mode: 'word', templateId: 'meeting-minutes', revision: '20261012.1' }
    let builds = 0
    for (let turn = 0; turn < 5; turn += 1) {
      const planned = planOfficeTurn({
        office,
        messages,
        templates,
        request: turn === 0 ? office : undefined,
      })
      if (turn === 0) {
        builds += 1
        expect(planned.modelAddition).toContain('office-docx 指南')
        expect(planned.modelAddition).toContain('OfficeCLI DOCX Skill')
        expect(planned.modelAddition).toContain('meeting-minutes@20261012.1')
        expect(planned.modelAddition).toContain('<business_skill name="meeting-recap">')
        expect(planned.modelAddition).toContain('行动项')
        expect(planned.modelAddition).toContain('Selection 文件交付')
        expect(planned.modelAddition).toContain('--render native')
        expect(planned.modelAddition).toContain('printToPDF')
      } else {
        expect(planned.modelAddition).toBeUndefined()
      }
      messages = planned.messages
      office = planned.office!
    }
    expect(builds).toBe(1)
    expect(projectOfficeModelContext(messages).match(/<business_skill name="meeting-recap">/g)).toHaveLength(1)
    expect(office.injectionFingerprint).toBe('word:meeting-minutes@20261012.1')
    expect(officeFingerprint(office)).toBe(office.injectionFingerprint!)
  })

  test('M2: switching to Excel replaces the Word injection', () => {
    const templates = listOfficeTemplates()
    const first = planOfficeTurn({
      messages: [],
      templates,
      request: { mode: 'word', templateId: 'meeting-minutes', revision: '20261012.1' },
    })
    const second = planOfficeTurn({
      office: first.office,
      messages: first.messages,
      templates,
      request: { mode: 'excel', templateId: 'annual-business', revision: '20260914.1' },
    })
    const projected = projectOfficeModelContext(second.messages)
    expect(projected).toContain(OFFICE_FORMAT_UPDATED)
    expect(projected).not.toContain('<business_skill name="meeting-recap">')
    expect(projected).toContain('<business_skill name="saas-metrics-coach">')
    expect(projected).toContain('office-xlsx 指南')
    expect(projected).toContain('OfficeCLI XLSX Skill')
    expect(second.modelAddition).toContain(OFFICE_FORMAT_UPDATED)
    expect(second.office?.injectionFingerprint).toBe('excel:annual-business@20260914.1')
    expect(activeText(second.messages).match(/输出格式已按当前会话选择更新/g)).toHaveLength(1)
  })

  test('M3: a mid-mode upload stays user material', () => {
    const templates = listOfficeTemplates()
    const selected = { mode: 'word' as const, templateId: 'meeting-minutes', revision: '20261012.1' }
    const first = planOfficeTurn({ messages: [], templates, request: selected })
    const kept = officeAttachmentsKeepTemplate(['会议记录.txt', 'example.docx'], first.office!)
    expect(kept.templateId).toBe('meeting-minutes')
    expect(kept.revision).toBe('20261012.1')
    const second = planOfficeTurn({ office: first.office, messages: first.messages, templates })
    expect(second.modelAddition).toBeUndefined()
    const note = officeUserMaterialNote(['会议记录.txt'])
    expect(note).toContain('用户材料')
    expect(note).toContain('会议记录.txt')
    expect(note).not.toContain('meeting-minutes@')
    expect(first.modelAddition).toContain('中途上传的文件是用户材料')
  })

  test('M4: a forged revision and an oversized body are rejected', () => {
    const templates = listOfficeTemplates()
    expect(() => executeOfficeTemplates({
      raw: JSON.stringify({ endpoint: 'select', templateId: 'meeting-minutes', revision: '19990101.1' }),
      sessionId: 'session-1',
      templates,
    })).toThrow('请刷新目录后重新选择')
    expect(() => officeTemplatePreview('meeting-minutes', '19990101.1', undefined, templates)).toThrow('请刷新目录后重新选择')
    expect(() => executeOfficeTemplates({ raw: 'x'.repeat(OFFICE_REQUEST_MAX_BYTES + 1), sessionId: 'session-1' })).toThrow('16 KB')
    const fresh = listOfficeTemplates().map(item => item.id === 'meeting-minutes' ? { ...item, revision: '20261013.1' } : item)
    expect(() => planOfficeTurn({
      office: { mode: 'word', templateId: 'meeting-minutes', revision: '20261012.1' },
      messages: [],
      templates: fresh,
    })).toThrow('需要重新选择')
  })

  test('deselect and compaction keep one fingerprint', () => {
    const templates = listOfficeTemplates()
    const selected = planOfficeTurn<OfficeTranscriptMessage>({
      messages: [],
      templates,
      request: { mode: 'word', templateId: 'meeting-minutes', revision: '20261012.1' },
    })
    const dropped = selected.messages.filter(message => !message.officeInjection)
    const preserved = preserveOfficeInjection(dropped, selected.office!, templates)
    expect(preserved.office.injectionFingerprint).toBe(selected.office?.injectionFingerprint)
    expect(projectOfficeModelContext(preserved.messages).match(/<business_skill name="meeting-recap">/g)).toHaveLength(1)
    const cleared = executeOfficeTemplates({
      raw: JSON.stringify({ endpoint: 'deselect' }),
      sessionId: 'session-1',
      office: preserved.office,
      templates,
    })
    const after = planOfficeTurn({ office: cleared.office, messages: preserved.messages, templates })
    expect(projectOfficeModelContext(after.messages)).toContain(OFFICE_FORMAT_UPDATED)
    expect(projectOfficeModelContext(after.messages)).not.toContain('meeting-minutes@20261012.1')
    expect(after.office?.injectionFingerprint).toBe('word')
  })

  test('PPT and Word exclude each other, and PPT does not author with office-pptx', () => {
    const templates = listOfficeTemplates()
    const word = planOfficeTurn({
      messages: [{ id: 'u', role: 'user', content: '写纪要' }],
      templates,
      request: { mode: 'word', templateId: 'meeting-minutes', revision: '20261012.1' },
    })
    expect(word.clearPpt).toBe(true)
    expect(authoringSkillForMode('word')).toEqual({ skill: 'officecli-docx', allowOfficePptxAuthoring: false })
    expect(word.modelAddition).toContain('不要把 officecli-pptx 当作本次成稿技能')
    expect(() => planOfficeTurn({ office: word.office, messages: word.messages, templates, request: word.office, ppt: true })).toThrow('不能同时选择')
    const back = planOfficeTurn({ office: word.office, messages: word.messages, templates, ppt: true })
    expect(back.office).toBeUndefined()
    expect(projectOfficeModelContext(back.messages)).toContain(OFFICE_FORMAT_UPDATED)
    expect(authoringSkillForMode('ppt')).toEqual({ skill: 'ppt-design', allowOfficePptxAuthoring: false })
    expect(authoringSkillForMode('excel').skill).toBe('officecli-xlsx')
  })

  test('Word mode does not change the NORM / PRO boundary', () => {
    expect(() => pptSendOptions('NORM', undefined, { ppt: { templateId: 'dsh-cartesian' } })).toThrow('PRO')
    const templates = listOfficeTemplates()
    const planned = planOfficeTurn({
      messages: [],
      templates,
      request: { mode: 'excel', templateId: 'annual-business', revision: '20260914.1' },
    })
    expect(planned.office?.mode).toBe('excel')
    expect(buildOfficeInjection(planned.office!, templates)).toContain('officeRender.recalc')
  })

  test('catalog lists the contract and leaves the fictional recipes alone', () => {
    const root = join(import.meta.dir, '../../../../apps/electron/resources/skills/office-business')
    const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8')) as { cases: Array<{ id: string; businessSkill?: string; revision?: string }> }
    expect(catalog.cases.map(item => item.id).slice(0, wordCaseIds.length)).toEqual(wordCaseIds)
    expect(catalog.cases.find(item => item.id === 'meeting-minutes')).toMatchObject({ businessSkill: 'meeting-recap', revision: '20261012.1' })
    expect(readFileSync(join(root, 'cases/selection-samples/meeting-minutes.json'), 'utf8')).toContain('11月3日')
    expect(catalog.cases.map(item => item.id)).toEqual([
      ...wordCaseIds, 'annual-business', 'port-cargo', 'bio-assay',
    ])
    const preview = officeTemplatePreview('annual-business', '20260914.1', 20, listOfficeTemplates(), root)
    expect(preview.available).toBe(false)
    expect(preview.path).toBe('sources/legacy/annual-business/preview/20.png')
    expect(() => officeTemplatePreview('annual-business', '20260914.1', 21, listOfficeTemplates(), root)).toThrow('超出')
    const listed = executeOfficeTemplates({ raw: JSON.stringify({ endpoint: 'catalog' }) })
    expect(listed.result.templates).toHaveLength(10)
    expect(listed.result.mode).toBeNull()
  })

  test('business skills are registered for the model and for explicit user invocation', () => {
    const skills = loadAllSkills('/tmp/office-mode-skills')
    for (const slug of ['meeting-recap', 'saas-metrics-coach', 'gov-doc-writing']) {
      expect(loadSkillBySlug('/tmp/office-mode-skills', slug)?.source).toBe('bundled')
      expect(filterUserFacingSkills(skills).some(item => item.slug === slug)).toBe(true)
      expect(toSkillCatalogEntries(skills).some(item => item.slug === slug)).toBe(true)
    }
    expect(loadSkillBySlug('/tmp/office-mode-skills', 'gov-doc-writing')?.content).toContain('未复用')
    expect(filterUserFacingSkills(skills).some(item => item.slug === 'ppt-design')).toBe(false)
  })

  test('render follows the decided native-first order and does not call a backend by itself', async () => {
    const absent = resolveOfficeRenderPlan({
      ...getOfficeRenderCapabilities(),
      platform: 'linux',
      exporterPdfPlugin: false,
      word: false,
      powerpoint: false,
      excel: false,
      electronPrintToPdf: true,
      electronCapturePage: true,
    })
    expect(absent.pdf.map(step => step.id)).toEqual(['officecli-html-electron-printToPDF', 'selection-html-paginator'])
    expect(absent.preview[0]?.id).toBe('officecli-html-electron-capturePage')
    expect(absent.formula.map(step => step.id)).toEqual(['officecli-computed-writeback', 'selection-formula-fallback'])
    const windows = resolveOfficeRenderPlan({
      platform: 'win32',
      electronPrintToPdf: true,
      electronCapturePage: true,
      officecliHtml: true,
      officecliFormula: true,
      exporterPdfPlugin: true,
      word: true,
      powerpoint: true,
      excel: true,
    })
    expect(windows.pdf.map(step => step.id).slice(0, 2)).toEqual(['officecli-view-pdf-plugin', 'word-export-pdf'])
    expect(windows.preview[0]?.id).toBe('officecli-screenshot-native')
    expect(windows.formula.map(step => step.id)).toEqual(['officecli-computed-writeback', 'excel-calculate-full', 'selection-formula-fallback'])
    setOfficeRenderCapabilities(null)
    expect(await officeRenderPreview({ sourcePath: '/tmp/a.docx' })).toMatchObject({ unavailable: true, step: 'officecli-html-electron-capturePage' })
    setOfficeRenderHosts({ async preview(_request, step) { return { kind: 'png', step: step.id, bytes: new Uint8Array([1]) } } })
    try {
      expect((await officeRenderRecalc({ sourcePath: '/tmp/a.xlsx' })).step).toBe('officecli-computed-writeback')
      const painted = await officeRenderPreview({ sourcePath: '/tmp/a.docx' })
      expect('kind' in painted && painted.kind).toBe('png')
    } finally {
      setOfficeRenderHosts(null)
      setOfficeRenderCapabilities(null)
    }
  })
  test('every Word / Excel case carries compact hidden guidance', () => {
    const templates = listOfficeTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(10)
    for (const template of templates) {
      const guidance = template.guidance ?? ''
      expect(guidance.length, template.id).toBeGreaterThanOrEqual(80)
      expect(guidance.length, template.id).toBeLessThanOrEqual(150)
      expect(guidance, template.id).toContain('待补充')
      expect(guidance, template.id).toContain('用户这次的要求优先')
      expect(guidance, template.id).toMatch(/不照搬|不沿用|不把/)
    }
  })

  test('the selected case guidance is injected next to the case id, tool order and skills; no case, no guidance', () => {
    const templates = listOfficeTemplates()
    for (const template of templates) {
      const injection = buildOfficeInjection({ mode: template.mode, templateId: template.id, revision: template.revision }, templates)
      const head = injection.slice(injection.indexOf('当前界面所选 Office 案例'))
      expect(head, template.id).toContain(`selected_template_id: ${template.id}`)
      expect(head, template.id).toContain(`office_template(template_id="${template.id}")`)
      expect(head, template.id).toContain(`案例参考要点：${template.guidance}`)
      expect(head.indexOf('案例参考要点'), template.id).toBeGreaterThan(head.indexOf('office_template(template_id='))
    }
    const planned = planOfficeTurn({ messages: [], templates, request: { mode: 'word', templateId: 'coffee-market', revision: templates.find(item => item.id === 'coffee-market')!.revision } })
    expect(planned.modelAddition).toContain(`案例参考要点：${templates.find(item => item.id === 'coffee-market')!.guidance}`)
    for (const mode of ['word', 'excel'] as const) {
      const bare = buildOfficeInjection({ mode }, templates)
      expect(bare).not.toContain('案例参考要点')
      for (const template of templates) expect(bare).not.toContain(template.guidance!)
    }
  })

  test('case guidance never reaches the composer', () => {
    const renderer = join(import.meta.dir, '../../../../apps/electron/src/renderer')
    for (const file of ['components/office/OfficeCaseGallery.tsx', 'components/office/OfficeSelectedCase.tsx', 'components/office/OfficeSessionCase.tsx']) {
      const source = readFileSync(join(renderer, file), 'utf8')
      expect(source, file).not.toContain('guidance')
    }
    expect(readFileSync(join(renderer, 'components/office/OfficeCaseGallery.tsx'), 'utf8')).not.toContain('craft:insert-text')
  })
})
