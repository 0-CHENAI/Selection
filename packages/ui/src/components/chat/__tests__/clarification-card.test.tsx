import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { Message } from '@craft-agent/core/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let ClarificationCard: typeof import('../ClarificationCard').ClarificationCard
let ClarificationSummary: typeof import('../ClarificationCard').ClarificationSummary
let clarificationNoteLayout: typeof import('../ClarificationCard').clarificationNoteLayout
let clarificationSummaryLabel: typeof import('../ClarificationCard').clarificationSummaryLabel

beforeAll(async () => {
  const module = await import('../ClarificationCard')
  ClarificationCard = module.ClarificationCard
  ClarificationSummary = module.ClarificationSummary
  clarificationNoteLayout = module.clarificationNoteLayout
  clarificationSummaryLabel = module.clarificationSummaryLabel
})

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  resources: {
    'zh-Hans': {
      translation: {
        'chat.clarificationAnswered_one': '已澄清',
        'chat.clarificationAnswered_other': '{{count}} 个已澄清',
        'chat.clarificationContinue': '继续',
        'chat.clarificationFreeText': '补充说明',
        'chat.clarificationFreeTextPlaceholder': '直接写下答案，或补充你的选择',
        'chat.clarificationMultiHint': '可多选，也可以直接填写，或两者一起',
        'chat.clarificationSingleHint': '选择一项，也可以直接填写，或两者一起',
        'chat.clarificationSkip': '跳过',
        'chat.clarificationSkipped': '已跳过，按当前理解继续',
        'chat.clarificationSkippedCount_one': '已跳过',
        'chat.clarificationSkippedCount_other': '{{count}} 个跳过',
        'chat.clarificationSummaryMixed': '{{answered}} 个已澄清，{{skipped}} 个跳过',
        'chat.clarificationTextHint': '写下答案，或跳过',
        'chat.clarificationTitle': '需要确认',
        'chat.clarificationYourAnswer': '你的回答',
      },
    },
  },
})

function card(overrides: Partial<NonNullable<Message['clarification']>> = {}): Message {
  return {
    id: 'card-1',
    role: 'clarification',
    content: '报告覆盖哪一年？',
    timestamp: 1,
    clarification: {
      requestId: 'req-1',
      question: '报告覆盖哪一年？',
      ambiguity: 'scope',
      selection: 'multi',
      options: [{ id: '2024', label: '2024' }, { id: '2025', label: '2025' }],
      round: 1,
      status: 'pending',
      originSessionId: 'session',
      ...overrides,
    },
  }
}

function render(props: ComponentProps<typeof ClarificationCard>) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ClarificationCard {...props} />
    </I18nextProvider>,
  )
}

function renderSummary(messages: ComponentProps<typeof ClarificationSummary>['messages'], defaultExpanded = false) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ClarificationSummary messages={messages} defaultExpanded={defaultExpanded} />
    </I18nextProvider>,
  )
}

describe('clarification card', () => {
  it('shows choices and a free-text field together, with skip, and is not an answer card', () => {
    const html = render({ message: card(), interactive: true })
    expect(html).toContain('data-clarification-card')
    expect(html).not.toContain('data-response-card')
    expect(html).toContain('data-clarification-options')
    expect(html).toContain('data-clarification-option="2024"')
    expect(html).toContain('data-clarification-option="2025"')
    expect(html).toContain('data-clarification-text')
    expect(html).toContain('补充说明')
    expect(html).toContain('直接写下答案，或补充你的选择')
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ''
    expect(textarea).toContain('data-clarification-text')
    expect(textarea).toContain('overflow-hidden')
    expect(textarea).not.toContain('border-border')
    expect(textarea).not.toContain('resize-y')
    expect(html).toContain('data-clarification-note-fade="off"')
    expect(html).toContain('data-clarification-skip')
    expect(html).toContain('跳过')
    expect(html).toContain('disabled')
    expect(html).toContain('继续')
  })

  it('keeps the text field when there are no choices', () => {
    const html = render({ message: card({ options: [], selection: 'single' }), interactive: true })
    expect(html).toContain('data-clarification-text')
    expect(html).not.toContain('data-clarification-options')
    expect(html).toContain('写下答案，或跳过')
  })

  it('caps the note at five lines and fades only the scrolled-away top', () => {
    const line = 20
    const pad = 16
    const min = line * 2 + pad
    const max = line * 5 + pad
    expect(clarificationNoteLayout(min, 0)).toEqual({ height: min, overflows: false, fadeTop: false })
    expect(clarificationNoteLayout(line * 4 + pad, 0)).toEqual({ height: line * 4 + pad, overflows: false, fadeTop: false })
    expect(clarificationNoteLayout(line * 8 + pad, 0)).toEqual({ height: max, overflows: true, fadeTop: false })
    expect(clarificationNoteLayout(line * 8 + pad, 24)).toEqual({ height: max, overflows: true, fadeTop: true })
  })

  it('shows a skipped card without asking again', () => {
    const html = render({ message: card({ status: 'skipped' }), interactive: true })
    expect(html).toContain('data-clarification-badge')
    expect(html).toContain('已跳过')
    expect(html).toContain('data-clarification-open="false"')
    expect(html).toContain('data-clarification-preview')
    expect(html).toContain('报告覆盖哪一年')
    expect(html).not.toContain('按当前理解继续')
    expect(html).not.toContain('data-clarification-skip=""')
    expect(html).not.toContain('data-clarification-text')
    expect(html).not.toContain('data-clarification-detail')
  })

  it('collapses an answered clarification into a card and expands to the question, options, and answer', () => {
    const answered = card({ status: 'answered', selectedOptionIds: ['2024'], text: '只要表格' })
    const collapsed = render({ message: answered })
    expect(collapsed).toContain('data-clarification-open="false"')
    expect(collapsed).toContain('rounded-xl')
    expect(collapsed).toContain('px-4')
    expect(collapsed).toContain('py-3')
    expect(collapsed).not.toContain('rounded-[5px]')
    expect(collapsed).toContain('>已澄清<')
    expect(collapsed).toContain('data-clarification-preview')
    expect(collapsed).toContain('报告覆盖哪一年')
    expect(collapsed).not.toContain('只要表格')
    expect(collapsed).not.toContain('data-clarification-answer')
    expect(collapsed).not.toContain('data-clarification-option')
    const header = collapsed.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(header.indexOf('data-clarification-badge')).toBeGreaterThan(-1)
    expect(header.indexOf('data-clarification-badge')).toBeLessThan(header.lastIndexOf('<svg'))

    const html = render({ message: answered, defaultExpanded: true })
    expect(html).toContain('data-clarification-open="true"')
    expect(html).toContain('rotate-90')
    expect(html).not.toContain('data-clarification-preview')
    expect(html).toContain('报告覆盖哪一年')
    expect(html).toContain('data-clarification-option="2024"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('rounded-lg')
    expect(html).toContain('data-clarification-option="2025"')
    expect(html).toContain('data-selected="false"')
    expect(html).toContain('你的回答')
    expect(html).toContain('只要表格')
  })

  it('summarizes several settled questions, including a mix of answers and skips', () => {
    const translate = i18n.t.bind(i18n)
    expect(clarificationSummaryLabel({ answered: 1, skipped: 0 }, translate)).toBe('已澄清')
    expect(clarificationSummaryLabel({ answered: 3, skipped: 0 }, translate)).toBe('3 个已澄清')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 1 }, translate)).toBe('已跳过')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 2 }, translate)).toBe('2 个跳过')
    expect(clarificationSummaryLabel({ answered: 2, skipped: 1 }, translate)).toBe('2 个已澄清，1 个跳过')

    const answered = card({ status: 'answered', selectedOptionIds: ['2025'], text: '用 2025' })
    const skipped = card({ status: 'skipped', requestId: 'req-2', question: '要附录吗？' })
    skipped.id = 'card-2'
    const html = renderSummary([answered, skipped, { ...answered, id: 'card-3' }])
    expect(html).toContain('data-clarification-summary')
    expect(html).toContain('data-clarification-status="mixed"')
    expect(html).toContain('2 个已澄清，1 个跳过')
    expect(html).toContain('data-clarification-open="false"')
    expect(html).toContain('data-clarification-preview')
    expect(html).toContain('报告覆盖哪一年？、要附录吗？')
    expect(html).not.toContain('data-clarification-detail')

    const open = renderSummary([answered, skipped], true)
    expect(open).toContain('data-clarification-detail')
    expect(open).not.toContain('data-clarification-preview')
    expect(open).toContain('要附录吗？')
    expect(open).toContain('已跳过，按当前理解继续')
    expect(open).toContain('用 2025')
  })
})
