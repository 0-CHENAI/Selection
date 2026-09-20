import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

    expect(countOccurrences(html, '思考中…')).toBe(1)
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

    expect(countOccurrences(html, 'Thinking...')).toBe(1)
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

  it('does not render submit_answer as a work-chain step', async () => {
    const html = await renderTurn('zh-Hans', [
      {
        id: 'search-1',
        type: 'tool',
        status: 'completed',
        timestamp: 1,
        toolName: 'WebSearch',
        displayName: '搜索网页',
        intent: '查找 DeepSeek V4.1 Flash',
      },
      {
        id: 'submit-1',
        type: 'tool',
        status: 'completed',
        timestamp: 2,
        toolName: 'submit_answer',
        displayName: 'Submit V4.1 Flash Research',
        intent: '提交 GPT-6 与 Fable 5.1 对比的完整回答',
        toolInput: { answer: '最终正文' },
      },
    ], { isComplete: true, isStreaming: false })

    expect(html).toContain('查找 DeepSeek V4.1 Flash')
    expect(html).not.toContain('现在让我来给你正式回复')
    expect(html).not.toContain('Submit V4.1 Flash Research')
    expect(html).not.toContain('提交 GPT-6 与 Fable 5.1 对比的完整回答')
    expect(html).not.toContain('submit_answer')
  })

  it('crossfades the thinking placeholder when a new tool takes its slot', () => {
    const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
    const row = src.slice(src.indexOf('function WorkChainRow'), src.indexOf('function ActivityErrorBadge'))
    expect(row).toContain('height: 0')
    expect(row).toContain("height: 'auto'")
    expect(src).toContain('key="thinking"')
    // First row joining a live header must animate; history must not.
    expect(src).toContain('<AnimatePresence mode="sync" initial={chromeWasMounted && !isComplete}>')
    // Row spacing sits inside the height tween — no container margin to pop on unmount.
    expect(row).toContain('<div className="py-px">{children}</div>')
    const list = src.slice(src.indexOf('ref={activitiesContainerRef}'), src.indexOf('<AnimatePresence mode="sync"'))
    expect(list).not.toContain('space-y-0.5')
    expect(src).toContain('function WorkHeaderIcon')
    expect(src).toContain('function WorkHeaderStepCount')
    expect(src).not.toContain('standalone-thinking')
    const icon = src.slice(src.indexOf('function WorkHeaderIcon'), src.indexOf('function WorkHeaderStepCount'))
    expect(icon).not.toContain('absolute inset-0')
    const count = src.slice(src.indexOf('function WorkHeaderStepCount'), src.indexOf('function WorkChrome'))
    // Badge chrome is the origin/main badge; only the slide-open wrapper is new.
    expect(count).toContain('shrink-0 px-1.5 py-0.5 rounded-[4px] bg-background shadow-minimal text-[10px] font-medium tabular-nums')
    expect(count).toContain("width: 'auto'")
    expect(count).not.toContain('grid-template-columns')
    // Header, response card and chat processing row share one height presence
    // instead of popping in and out around each header phase.
    const presence = src.slice(src.indexOf('export function HeightPresence'), src.indexOf('function WorkChrome'))
    expect(presence).toContain("height: 'auto'")
    expect(presence).toContain('exit=')
    expect(src).toContain('<WorkChrome')
    expect(src).toMatch(/<HeightPresence\s+key="response"/)
    // Root spacing sits inside the tweened blocks, never as a sibling margin.
    expect(src).not.toContain('<div className="space-y-1">')
    const chatDisplay = readFileSync(
      join(import.meta.dir, '../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx'),
      'utf8',
    )
    expect(chatDisplay).toContain('<HeightPresence key="processing-indicator"')
    expect(chatDisplay).not.toContain('py-1 -mb-1 text-[13px] text-muted-foreground">\n      {/* Spinner in same location as TurnCard chevron */}\n      <div className="w-3 h-3 flex items-center justify-center shrink-0">\n        <Spinner className="text-[10px]" />\n      </div>\n      {/* Label with crossfade')
  })

  it('keeps the numbered work header once the turn completes', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'tool-1',
      type: 'tool',
      status: 'completed',
      timestamp: 1,
      toolName: 'Read',
    }], {
      isComplete: true,
      isStreaming: false,
    })

    expect(html).toContain('读取文件')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('shrink-0 px-1.5 py-0.5 rounded-[4px] bg-background shadow-minimal text-[10px] font-medium tabular-nums')
    expect(html).toMatch(/>1<\/span>/)
    expect(countOccurrences(html, '思考中…')).toBe(0)
    expect(countOccurrences(html, 'class="spinner ')).toBe(0)
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
