import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { Message } from '@craft-agent/core/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let ClarificationCard: typeof import('../ClarificationCard').ClarificationCard
let clarificationNoteLayout: typeof import('../ClarificationCard').clarificationNoteLayout

beforeAll(async () => {
  const module = await import('../ClarificationCard')
  ClarificationCard = module.ClarificationCard
  clarificationNoteLayout = module.clarificationNoteLayout
})

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  resources: {
    'zh-Hans': {
      translation: {
        'chat.clarificationContinue': '继续',
        'chat.clarificationFreeText': '补充说明',
        'chat.clarificationFreeTextPlaceholder': '直接写下答案，或补充你的选择',
        'chat.clarificationMultiHint': '可多选，也可以直接填写，或两者一起',
        'chat.clarificationSingleHint': '选择一项，也可以直接填写，或两者一起',
        'chat.clarificationSkip': '跳过',
        'chat.clarificationSkipped': '已跳过，按当前理解继续',
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
    expect(html).toContain('已跳过，按当前理解继续')
    expect(html).not.toContain('data-clarification-skip=""')
    expect(html).not.toContain('data-clarification-text')
  })
})
