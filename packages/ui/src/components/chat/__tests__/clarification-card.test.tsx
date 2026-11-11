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
let clarificationOutcomeCounts: typeof import('../ClarificationCard').clarificationOutcomeCounts
let clarificationSummaryLabel: typeof import('../ClarificationCard').clarificationSummaryLabel
let TurnCard: typeof import('../TurnCard').TurnCard

beforeAll(async () => {
  const module = await import('../ClarificationCard')
  ClarificationCard = module.ClarificationCard
  ClarificationDetailsOverlay = module.ClarificationDetailsOverlay
  ClarificationFoldDetails = module.ClarificationFoldDetails
  clarificationBriefTitle = module.clarificationBriefTitle
  clarificationOutcomeCounts = module.clarificationOutcomeCounts
  clarificationSummaryLabel = module.clarificationSummaryLabel
  TurnCard = (await import('../TurnCard')).TurnCard
})

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  resources: {
    'zh-Hans': {
      translation: {
        'chat.clarificationAnswered_one': '{{count}} 个问题已澄清',
        'chat.clarificationAnswered_other': '{{count}} 个问题已澄清',
        'chat.clarificationAnsweredShort': '已回答',
        'chat.clarificationContinue': '继续',
        'chat.clarificationDismiss': '关闭',
        'chat.clarificationFreeTextPlaceholder': '直接写下答案，或补充你的选择',
        'chat.clarificationRecorded': '已记录你的回答。',
        'chat.clarificationSkip': '跳过',
        'chat.clarificationSkipped': '已跳过，按当前理解继续',
        'chat.clarificationSkippedCount_one': '{{count}} 个问题已跳过',
        'chat.clarificationSkippedCount_other': '{{count}} 个问题已跳过',
        'chat.clarificationSkippedShort': '已跳过',
        'chat.clarificationStep': '第 {{current}} 题，共 {{total}} 题：{{title}}',
        'chat.clarificationStepAnswered': '（已回答）',
        'chat.clarificationStepSkipped': '（未回答）',
        'chat.clarificationSubmit': '提交',
        'chat.clarificationSummaryMixed': '{{answered}} 个问题已澄清，{{skipped}} 个已跳过',
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

const previewQuestions = [
  {
    id: 'audience',
    question: '这份报告主要给谁看？',
    selection: 'single' as const,
    options: [
      { id: 'exec', label: '管理层，用于决策评审' },
      { id: 'team', label: '业务团队，用于落地执行' },
      { id: 'client', label: '外部客户，用于正式汇报' },
    ],
  },
  {
    id: 'years',
    question: '这次需要覆盖哪些年份？',
    selection: 'multi' as const,
    options: [{ id: '2024', label: '2024' }, { id: '2025', label: '2025' }, { id: '2026', label: '2026' }],
  },
  {
    id: 'form',
    question: '交付形式更倾向哪种？',
    selection: 'single' as const,
    options: [
      { id: 'slides', label: '幻灯片汇报' },
      { id: 'doc', label: '书面报告' },
      { id: 'both', label: '两者都要' },
    ],
  },
]

function batch(overrides: Partial<NonNullable<Message['clarification']>> = {}): Message {
  return card({
    question: previewQuestions[0]!.question,
    selection: 'single',
    options: previewQuestions[0]!.options,
    questions: previewQuestions,
    round: 3,
    ...overrides,
  })
}

function render(props: ComponentProps<typeof ClarificationCard>) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ClarificationCard {...props} />
      </TooltipProvider>
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
  it('shows Motif question-card chrome: radios or checkboxes, a single-line note, skip, and submit', () => {
    const html = render({ message: card(), interactive: true })
    expect(html).toContain('data-clarification-card')
    expect(html).toContain('rounded-2xl')
    expect(html).toContain('bg-card')
    expect(html).not.toContain('data-response-card')
    expect(html).toContain('data-clarification-options')
    expect(html).toContain('data-clarification-option="2024"')
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('data-clarification-text')
    expect(html).toContain('直接写下答案，或补充你的选择')
    expect(html).toContain('<input')
    expect(html).toContain('h-10')
    expect(html).toContain('rounded-xl')
    expect(html).not.toContain('<textarea')
    expect(html).toContain('data-clarification-skip')
    expect(html).toContain('跳过')
    expect(html).toContain('提交')
    expect(html).toContain('data-clarification-submit')
    expect(html).toContain('data-clarification-dismiss')
    expect(html).toContain('rounded-full')
  })

  it('keeps the text field when there are no choices', () => {
    const html = render({ message: card({ options: [], selection: 'single' }), interactive: true })
    expect(html).toContain('data-clarification-text')
    expect(html).not.toContain('data-clarification-options')
  })

  it('walks a batch one step at a time with skip, continue, and an always-enabled submit', () => {
    const first = render({ message: batch(), interactive: true })
    expect(first).toContain('data-clarification-question-count="3"')
    expect(first).toContain('data-clarification-step="0"')
    expect(first).toContain('这份报告主要给谁看？')
    expect(first).toContain('role="radio"')
    expect(first).toContain('继续')
    expect(first).not.toContain('data-clarification-submit')
    expect(first).toContain('data-clarification-step-bar="audience"')
    expect(first).toContain('data-clarification-step-bar="years"')
    expect(first).toContain('data-clarification-bar-state="current"')
    const unansweredContinue = first.match(/data-clarification-continue[\s\S]*?>/)?.[0] ?? ''
    expect(unansweredContinue).toMatch(/(?:^|\s)disabled(?:=""|(?=\s|>))/)

    const answeredFirst = render({
      message: batch({
        questions: [
          { ...previewQuestions[0]!, selectedOptionIds: ['team'] },
          previewQuestions[1]!,
          previewQuestions[2]!,
        ],
      }),
      interactive: true,
    })
    const answeredContinue = answeredFirst.match(/data-clarification-continue[\s\S]*?>/)?.[0] ?? ''
    expect(answeredContinue).not.toMatch(/(?:^|\s)disabled(?:=""|(?=\s|>))/)

    const second = render({ message: batch(), interactive: true, initialStep: 1 })
    expect(second).toContain('data-clarification-step="1"')
    expect(second).toContain('这次需要覆盖哪些年份？')
    expect(second).toContain('role="checkbox"')
    expect(second).toContain('继续')

    const last = render({ message: batch(), interactive: true, initialStep: 2 })
    expect(last).toContain('data-clarification-step="2"')
    expect(last).toContain('交付形式更倾向哪种？')
    expect(last).toContain('data-clarification-skip')
    expect(last).toContain('提交')
    expect(last).toContain('data-clarification-submit')
    expect(last).toContain('data-clarification-bar-state="skipped"')
    const submit = last.match(/data-clarification-submit[\s\S]*?>/)?.[0] ?? ''
    expect(submit.length).toBeGreaterThan(0)
    expect(submit.includes('disabled')).toBe(false)
  })

  it('collapses an answered batch like Motif and keeps one process-fold row for the whole card', () => {
    const settled = batch({
      status: 'answered',
      questions: [
        { ...previewQuestions[0]!, status: 'answered', selectedOptionIds: ['team'] },
        { ...previewQuestions[1]!, status: 'skipped', selectedOptionIds: [], text: '' },
        { ...previewQuestions[2]!, status: 'answered', selectedOptionIds: ['doc'] },
      ],
    })
    const html = render({ message: settled, interactive: true })
    expect(html).toContain('data-clarification-card')
    expect(html).toContain('data-clarification-status="answered"')
    expect(html).toContain('已记录你的回答。')
    expect(html).toContain('交付形式更倾向哪种？')
    expect(html).not.toContain('data-clarification-options')
    expect(html).not.toContain('data-clarification-skip=""')

    expect(clarificationOutcomeCounts([settled])).toEqual({ answered: 2, skipped: 1 })
    const translate = i18n.t.bind(i18n)
    expect(clarificationSummaryLabel({ answered: 2, skipped: 1 }, translate)).toBe('2 个问题已澄清，1 个已跳过')

    settled.timestamp = 3
    const collapsed = renderFold([settled], false)
    expect(collapsed).toContain('data-clarification-folded')
    expect(collapsed).toContain('data-clarification-status="mixed"')
    expect(collapsed).toContain('2 个问题已澄清，1 个已跳过')
    expect(collapsed).not.toContain('data-clarification-row')
    expect(collapsed).not.toContain('已记录你的回答')

    const open = renderFold([settled], true)
    expect(open.match(/data-clarification-row/g)?.length).toBe(1)
    expect(open).toContain('2 个问题已澄清，1 个已跳过')
    expect(open).not.toContain('这份报告主要给谁看')
    expect(open).not.toContain('data-clarification-detail')

    const popup = renderPopup(settled)
    expect(popup).toContain('data-clarification-popup')
    expect(popup).toContain('这份报告主要给谁看')
    expect(popup).toContain('这次需要覆盖哪些年份')
    expect(popup).toContain('交付形式更倾向哪种')
    expect(popup).toContain('已回答')
    expect(popup).toContain('已跳过，按当前理解继续')
    expect(popup).toContain('data-clarification-option="team"')
    expect(popup).toContain('书面报告')
  })

  it('keeps the settled status in the process-fold brief title and a status row in the chain', () => {
    const answered = card({ status: 'answered', selectedOptionIds: ['2024'], text: '只要表格' })
    answered.timestamp = 3
    const collapsed = renderFold([answered], false)
    expect(collapsed).toContain('data-clarification-folded')
    expect(collapsed).toContain('data-clarification-brief')
    expect(collapsed).toContain('data-clarification-status="answered"')
    expect(collapsed).toContain('data-clarification-open="false"')
    expect(collapsed).toContain('>1 个问题已澄清<')
    expect(collapsed).not.toContain('>已澄清<')
    expect(collapsed).toContain('Check attachments')
    expect(collapsed).not.toContain('data-clarification-card')
    expect(collapsed).not.toContain('data-clarification-summary')
    expect(collapsed).not.toContain('data-clarification-detail')
    expect(collapsed).not.toContain('data-clarification-row')
    expect(collapsed).not.toContain('只要表格')
    expect(collapsed).not.toContain('Waiting for clarification')
    const header = collapsed.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(header.indexOf('data-clarification-brief')).toBeGreaterThan(-1)
    expect(header.indexOf('>1 个问题已澄清<')).toBeLessThan(header.indexOf('Check attachments'))

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
    expect(row.indexOf('data-clarification-icon')).toBeLessThan(row.indexOf('>1 个问题已澄清<'))

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
    expect(clarificationSummaryLabel({ answered: 1, skipped: 0 }, translate)).toBe('1 个问题已澄清')
    expect(clarificationSummaryLabel({ answered: 3, skipped: 0 }, translate)).toBe('3 个问题已澄清')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 1 }, translate)).toBe('1 个问题已跳过')
    expect(clarificationSummaryLabel({ answered: 0, skipped: 2 }, translate)).toBe('2 个问题已跳过')
    expect(clarificationSummaryLabel({ answered: 2, skipped: 1 }, translate)).toBe('2 个问题已澄清，1 个已跳过')
    expect(clarificationBriefTitle('Check attachments', '1 个问题已澄清', ['步骤已完成'])).toBe('1 个问题已澄清 · Check attachments')
    expect(clarificationBriefTitle('步骤已完成', '1 个问题已跳过', ['步骤已完成'])).toBe('1 个问题已跳过')
    expect(clarificationBriefTitle('正在回复', '3 个问题已澄清', ['正在回复', '思考中…'])).toBe('3 个问题已澄清')

    const answered = card({ status: 'answered', selectedOptionIds: ['2025'], text: '用 2025' })
    const skipped = card({ status: 'skipped', requestId: 'req-2', question: '要附录吗？' })
    skipped.id = 'card-2'
    const collapsed = renderFold([answered, skipped], false)
    expect(collapsed).toContain('data-clarification-status="mixed"')
    expect(collapsed).toContain('1 个问题已澄清，1 个已跳过')
    expect(collapsed).not.toContain('>已澄清<')
    expect(collapsed).not.toContain('data-clarification-detail')
    expect(collapsed).not.toContain('data-clarification-card')

    const open = renderFold([answered, skipped], true)
    expect(open.match(/data-clarification-row/g)?.length).toBe(2)
    expect(open).toContain('data-clarification-status="answered"')
    expect(open).toContain('data-clarification-status="skipped"')
    expect(open).toContain('>1 个问题已澄清<')
    expect(open).toContain('>1 个问题已跳过<')
    expect(open).not.toContain('>已澄清<')
    expect(open).not.toContain('>已跳过<')
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
