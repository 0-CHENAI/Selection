import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { Message } from '@craft-agent/core/types'
import { TooltipProvider } from '../../tooltip'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let ClarificationCard: typeof import('../ClarificationCard').ClarificationCard
let ClarificationDetailsOverlay: typeof import('../ClarificationCard').ClarificationDetailsOverlay
let ClarificationFoldDetails: typeof import('../ClarificationCard').ClarificationFoldDetails
let clarificationBriefTitle: typeof import('../ClarificationCard').clarificationBriefTitle
let clarificationNoteLayout: typeof import('../ClarificationCard').clarificationNoteLayout
let clarificationSummaryLabel: typeof import('../ClarificationCard').clarificationSummaryLabel
let TurnCard: typeof import('../TurnCard').TurnCard

beforeAll(async () => {
  const module = await import('../ClarificationCard')
  ClarificationCard = module.ClarificationCard
  ClarificationDetailsOverlay = module.ClarificationDetailsOverlay
  ClarificationFoldDetails = module.ClarificationFoldDetails
  clarificationBriefTitle = module.clarificationBriefTitle
  clarificationNoteLayout = module.clarificationNoteLayout
  clarificationSummaryLabel = module.clarificationSummaryLabel
  TurnCard = (await import('../TurnCard')).TurnCard
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
        'chat.processing.thinking': '思考中…',
        'turnCard.responding': '正在回复',
        'turnCard.starting': '开始',
        'turnCard.stepsCompleted': '步骤已完成',
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

function renderDetails(messages: ComponentProps<typeof ClarificationFoldDetails>['messages']) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ClarificationFoldDetails messages={messages} />
    </I18nextProvider>,
  )
}

function renderPopup(message: Message) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ClarificationDetailsOverlay message={message} isOpen embedded onClose={() => {}} />
    </I18nextProvider>,
  )
}

function renderFold(messages: Message[], expanded: boolean) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <TurnCard
          turnId="fold"
          intent="Check attachments"
          activities={[
            { id: 'read', type: 'tool', toolName: 'Read', status: 'completed', intent: 'Read the brief', timestamp: 1 },
            { id: 'clarify', type: 'tool', toolName: 'clarify', status: 'completed', content: 'Waiting for clarification', timestamp: 2 },
            { id: 'bash', type: 'tool', toolName: 'Bash', status: 'completed', intent: 'Check attachments', timestamp: 4 },
          ]}
          clarifications={messages}
          isStreaming={false}
          isComplete
          isExpanded={expanded}
          renderActionsMenu={() => null}
        />
      </TooltipProvider>
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

  it('does not render an answered or skipped clarification as its own card', () => {
    for (const status of ['answered', 'skipped'] as const) {
      const html = render({ message: card({ status, selectedOptionIds: ['2024'], text: '只要表格' }), interactive: true })
      expect(html).not.toContain('data-clarification-card')
      expect(html).not.toContain('data-clarification-summary')
      expect(html).not.toContain('data-clarification-text')
      expect(html).not.toContain('data-clarification-skip=""')
    }
  })

  it('keeps the settled status in the process-fold brief title and a status row in the chain', () => {
    const answered = card({ status: 'answered', selectedOptionIds: ['2024'], text: '只要表格' })
    answered.timestamp = 3
    const collapsed = renderFold([answered], false)
    expect(collapsed).toContain('data-clarification-folded')
    expect(collapsed).toContain('data-clarification-brief')
    expect(collapsed).toContain('data-clarification-status="answered"')
    expect(collapsed).toContain('data-clarification-open="false"')
    expect(collapsed).toContain('>已澄清<')
    expect(collapsed).toContain('Check attachments')
    expect(collapsed).not.toContain('data-clarification-card')
    expect(collapsed).not.toContain('data-clarification-summary')
    expect(collapsed).not.toContain('data-clarification-detail')
    expect(collapsed).not.toContain('data-clarification-row')
    expect(collapsed).not.toContain('只要表格')
    expect(collapsed).not.toContain('Waiting for clarification')
    const header = collapsed.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(header.indexOf('data-clarification-brief')).toBeGreaterThan(-1)
    expect(header.indexOf('>已澄清<')).toBeLessThan(header.indexOf('Check attachments'))

    const html = renderFold([answered], true)
    expect(html).toContain('data-clarification-open="true"')
    expect(html).toContain('data-clarification-row')
    expect(html).toContain('data-clarification-icon')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('data-clarification-fold=""')
    expect(html).not.toContain('data-clarification-popup')
    expect(html).not.toContain('data-clarification-card')
    expect(html).not.toContain('报告覆盖哪一年')
    expect(html).not.toContain('data-clarification-option')
    expect(html).not.toContain('你的回答')
    expect(html).not.toContain('只要表格')
    expect(html).toContain('Check attachments')
    expect(html).not.toContain('Waiting for clarification')
    const early = html.indexOf('Read the brief')
    const rowAt = html.indexOf('data-clarification-row')
    const later = html.lastIndexOf('Check attachments')
    expect(early).toBeGreaterThan(-1)
    expect(rowAt).toBeGreaterThan(early)
    expect(later).toBeGreaterThan(rowAt)
    const row = html.slice(rowAt, html.indexOf('</button>', rowAt))
    expect(row.indexOf('data-clarification-icon')).toBeLessThan(row.indexOf('>已澄清<'))

    const popup = renderPopup(answered)
    expect(popup).toContain('data-clarification-popup')
    expect(popup).toContain('报告覆盖哪一年')
    expect(popup).toContain('data-clarification-option="2024"')
    expect(popup).toContain('data-selected="true"')
    expect(popup).toContain('data-clarification-option="2025"')
    expect(popup).toContain('data-selected="false"')
    expect(popup).toContain('你的回答')
    expect(popup).toContain('只要表格')
    expect(popup).not.toContain('data-clarification-card')
  })

  it('summarizes several settled questions inside the same fold', () => {
    const translate = i18n.t.bind(i18n)
    expect(clarificationSummaryLabel({ answered: 1, skipped: 0 }, translate)).toBe('已澄清')
    expect(clarificationSummaryLabel({ answered: 3, skipped: 0 }, translate)).toBe('3 个已澄清')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 1 }, translate)).toBe('已跳过')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 2 }, translate)).toBe('2 个跳过')
    expect(clarificationSummaryLabel({ answered: 2, skipped: 1 }, translate)).toBe('2 个已澄清，1 个跳过')
    expect(clarificationBriefTitle('Check attachments', '已澄清', ['步骤已完成'])).toBe('已澄清 · Check attachments')
    expect(clarificationBriefTitle('步骤已完成', '已跳过', ['步骤已完成'])).toBe('已跳过')
    expect(clarificationBriefTitle('正在回复', '3 个已澄清', ['正在回复', '思考中…'])).toBe('3 个已澄清')

    const answered = card({ status: 'answered', selectedOptionIds: ['2025'], text: '用 2025' })
    const skipped = card({ status: 'skipped', requestId: 'req-2', question: '要附录吗？' })
    skipped.id = 'card-2'
    const collapsed = renderFold([answered, skipped], false)
    expect(collapsed).toContain('data-clarification-status="mixed"')
    expect(collapsed).toContain('1 个已澄清，1 个跳过')
    expect(collapsed).not.toContain('data-clarification-detail')
    expect(collapsed).not.toContain('data-clarification-card')

    const open = renderFold([answered, skipped], true)
    expect(open.match(/data-clarification-row/g)?.length).toBe(2)
    expect(open).toContain('data-clarification-status="answered"')
    expect(open).toContain('data-clarification-status="skipped"')
    expect(open).not.toContain('data-clarification-detail')
    expect(open).not.toContain('data-clarification-card')
    expect(open).not.toContain('要附录吗？')
    expect(open).not.toContain('用 2025')

    const details = renderDetails([answered, skipped])
    expect(details).toContain('data-clarification-fold')
    expect(details).toContain('要附录吗？')
    expect(details).toContain('已跳过，按当前理解继续')
    expect(details).toContain('用 2025')
    const skippedPopup = renderPopup(skipped)
    expect(skippedPopup).toContain('data-clarification-popup')
    expect(skippedPopup).toContain('要附录吗？')
    expect(skippedPopup).toContain('已跳过，按当前理解继续')
  })
})
