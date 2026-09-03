import * as React from 'react'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityItem } from '../TurnCard'

// TurnCard's markdown/overlay modules import Vite `?url` PDF workers, which
// Bun's server renderer cannot load. These branches are outside this test.
mock.module('../../markdown', () => ({
  Markdown: () => null,
}))
mock.module('../../overlay', () => ({
  DocumentFormattedMarkdownOverlay: () => null,
}))

let TurnCard: typeof import('../TurnCard').TurnCard

beforeAll(async () => {
  const turnCardModule = await import('../TurnCard')
  TurnCard = turnCardModule.TurnCard
})

afterAll(() => {
  mock.restore()
})

const resources = {
  en: {
    translation: {
      'turnCard.thinking': 'Thinking…',
    },
  },
  'zh-Hans': {
    translation: {
      'turnCard.thinking': '思考中…',
    },
  },
}

async function renderTurn(
  language: keyof typeof resources,
  activities: ActivityItem[],
  options: { isComplete?: boolean; isStreaming?: boolean } = {},
) {
  const testI18n = createInstance()
  await testI18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
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
  it('renders one localized status when a running intermediate row is visible', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'intermediate-1',
      type: 'intermediate',
      status: 'running',
      timestamp: 1,
      content: '',
    }])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(html).not.toContain('Thinking...')
  })

  it('uses the active language for a running intermediate row', async () => {
    const html = await renderTurn('en', [{
      id: 'intermediate-1',
      type: 'intermediate',
      status: 'running',
      timestamp: 1,
      content: '',
    }])

    expect(countOccurrences(html, 'Thinking…')).toBe(1)
  })

  it('keeps one standalone status before the first visible activity', async () => {
    const html = await renderTurn('zh-Hans', [])

    expect(countOccurrences(html, '思考中…')).toBe(1)
  })

  it('keeps one gap status after a tool completes', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'tool-1',
      type: 'tool',
      status: 'completed',
      timestamp: 1,
      toolName: 'Read',
    }])

    expect(countOccurrences(html, '思考中…')).toBe(1)
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
