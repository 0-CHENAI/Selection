import * as React from 'react'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityItem } from '../TurnCard'
import { TooltipProvider } from '../../tooltip'

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

async function renderErrorActivities(activities: ActivityItem[]) {
  const testI18n = createInstance()
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          common: { error: 'Error' },
        },
      },
    },
    interpolation: { escapeValue: false },
  })

  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TooltipProvider>
        <TurnCard
          turnId="issue-254"
          activities={activities}
          isStreaming={false}
          isComplete
          defaultExpanded
          renderActionsMenu={() => null}
        />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

describe('TurnCard activity error badge (#254)', () => {
  it('uses the shared error badge for native and MCP tool failures', async () => {
    const html = await renderErrorActivities([
      {
        id: 'ok',
        type: 'tool',
        status: 'completed',
        timestamp: 1,
        toolName: 'Read',
      },
      {
        id: 'native-error',
        type: 'tool',
        status: 'error',
        timestamp: 2,
        toolName: 'Write',
        error: 'ENOENT: no such file',
      },
      {
        id: 'mcp-error',
        type: 'tool',
        status: 'error',
        timestamp: 3,
        toolName: 'mcp__session__call_llm',
        error: 'upstream timeout',
      },
    ])

    expect(html.split('data-slot="activity-error-badge"').length - 1).toBe(2)
    expect(html).toContain('Write')
    expect(html).toContain('call_llm')
  })
})
