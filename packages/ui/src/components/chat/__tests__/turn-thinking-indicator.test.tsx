import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import testI18n from 'i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import zh from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityItem } from '../TurnCard'

// TurnCard's pure preview helpers use the shared i18next singleton, so the
// provider and helpers must use the same initialized instance and real locales.
// TurnCard's markdown/overlay modules import Vite `?url` PDF workers, which
// Bun's server renderer cannot load — match the Vite asset loader instead.
// Module mocks are process-wide in Bun, so never null out shared UI modules
// (../../markdown): sibling test files need the real implementation.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let TurnCard: typeof import('../TurnCard').TurnCard

beforeAll(async () => {
  const turnCardModule = await import('../TurnCard')
  TurnCard = turnCardModule.TurnCard
})

const resources = {
  en: {
    translation: en,
  },
  'zh-Hans': {
    translation: zh,
  },
}

async function renderTurn(
  language: keyof typeof resources,
  activities: ActivityItem[],
  options: { isComplete?: boolean; isStreaming?: boolean } = {},
) {
  await testI18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    keySeparator: false,
    resources,
    interpolation: { escapeValue: false },
  })

  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TurnCard
        turnId="issue-239"
        activities={activities}
        isStreaming={options.isStreaming ?? true}
        isComplete={options.isComplete ?? false}
        defaultExpanded
        renderActionsMenu={() => null}
      />
    </I18nextProvider>,
  )
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1
}

describe('TurnCard thinking indicator (#239)', () => {
  it('localizes the live header and renders one spinner for an intermediate row', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'intermediate-1',
      type: 'intermediate',
      status: 'running',
      timestamp: 1,
      content: '',
    }])

    expect(countOccurrences(html, '思考中…')).toBe(2)
    expect(countOccurrences(html, 'class="spinner ')).toBe(1)
    expect(html).not.toContain('Thinking...')
  })

  it('localizes the live header and indicator in English UI', async () => {
    const html = await renderTurn('en', [{
      id: 'intermediate-1',
      type: 'intermediate',
      status: 'running',
      timestamp: 1,
      content: '',
    }])

    expect(countOccurrences(html, 'Thinking...')).toBe(2)
    expect(countOccurrences(html, 'class="spinner ')).toBe(1)
  })

  it('keeps one standalone status before the first visible activity', async () => {
    const html = await renderTurn('zh-Hans', [])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'class="spinner ')).toBe(1)
  })

  it('shows the latest step in the header with one gap spinner after a tool completes', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'tool-1',
      type: 'tool',
      status: 'completed',
      timestamp: 1,
      toolName: 'Read',
    }])

    expect(html).toContain('读取文件')
    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'class="spinner ')).toBe(1)
  })

  it('does not add a second status below a visible running thinking row', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'thinking-1',
      type: 'thinking',
      status: 'running',
      timestamp: 1,
    }])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'class="spinner ')).toBe(1)
    expect(html).not.toContain('Thinking...')
  })

  it('renders submit_answer with the localized delivery label and no intent suffix', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'submit-1',
      type: 'tool',
      status: 'completed',
      timestamp: 1,
      toolName: 'submit_answer',
      intent: '提交 GPT-6 与 Fable 5.1 对比的完整回答',
      toolInput: { answer: '最终正文' },
    }])

    expect(html).toContain('现在让我来给你正式回复......')
    expect(html).not.toContain('提交 GPT-6 与 Fable 5.1 对比的完整回答')
    expect(html).not.toContain('submit_answer')
  })

  it('still hides a completed interrupted turn with no meaningful work', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'tool-1',
      type: 'tool',
      status: 'error',
      timestamp: 1,
      toolName: 'Read',
    }], {
      isComplete: true,
      isStreaming: false,
    })

    expect(html).toBe('')
  })
})
