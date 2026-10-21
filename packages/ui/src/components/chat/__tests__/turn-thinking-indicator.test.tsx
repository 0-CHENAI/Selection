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
import { TooltipProvider } from '../../tooltip'

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
  options: { isComplete?: boolean; isStreaming?: boolean; expanded?: boolean; hasExternalWorkStatus?: boolean; awaitingClarification?: boolean; onOpenActivityDetails?: (activity: ActivityItem) => void; workControls?: React.ReactNode; taskPreview?: boolean; response?: React.ComponentProps<typeof TurnCard>['response'] } = {},
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
      <TooltipProvider>
      <TurnCard
        turnId="issue-239"
        activities={activities}
        isStreaming={options.isStreaming ?? true}
        isComplete={options.isComplete ?? false}
        hasExternalWorkStatus={options.hasExternalWorkStatus}
        awaitingClarification={options.awaitingClarification}
        defaultExpanded={options.expanded ?? true}
        onOpenActivityDetails={options.onOpenActivityDetails}
        workControls={options.workControls}
        taskPreview={options.taskPreview}
        response={options.response}
        renderActionsMenu={() => null}
      />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1
}

describe('TurnCard thinking indicator (#239)', () => {
  it.each(['en', 'zh-Hans'] as const)('separates the task assignment, folded process and output only in task previews in %s', async language => {
    const activities: ActivityItem[] = [{ id: 'assignment', type: 'task-context', status: 'completed', timestamp: 1,
      taskContext: { kind: 'assignment', instruction: '独立核对原始金额。' },
    }, { id: 'read', type: 'tool', status: 'completed', timestamp: 2, toolName: 'Read' }]
    const options = { isComplete: true, isStreaming: false, expanded: false,
      response: { text: '核对结果：原始金额为 100 万元。', isStreaming: false } }
    const html = await renderTurn(language, activities, { ...options, taskPreview: true })
    expect(html).toContain('<section')
    expect(html).toContain('独立核对原始金额。')
    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('data-task-assignment-summary')).toBeLessThan(html.indexOf('aria-expanded="false"'))
    expect(html.indexOf('aria-expanded="false"')).toBeLessThan(html.indexOf('data-task-output-heading'))
    expect(html.indexOf('data-task-output-heading')).toBeLessThan(html.indexOf('data-search-root="response"'))
    expect(html).toContain(resources[language].translation['tasks.nodeOutputs'])
    expect(await renderTurn(language, activities, options)).not.toContain('data-task-output-heading')
    expect(await renderTurn(language, activities, { ...options, response: undefined, taskPreview: true })).not.toContain('data-task-output-heading')
  })
  it('keeps retry controls inside the work chain without a nested attempt history', async () => {
    const activities: ActivityItem[] = [{ id: 'node', type: 'status', status: 'error', timestamp: 1,
      taskNode: { title: '核对成本', sessionId: 'current', stateLabel: '失败' } }]
    const options = { isComplete: true, isStreaming: false, onOpenActivityDetails: () => {}, workControls: <button>重试失败节点</button> }
    const html = await renderTurn('zh-Hans', activities, options)
    expect(html).not.toContain('历史尝试')
    expect(html).not.toContain('第 1 次尝试')
    expect(html).toContain('重试失败节点')
    const collapsed = await renderTurn('zh-Hans', activities, { ...options, expanded: false })
    expect(collapsed).toMatch(/aria-hidden="true"[\s\S]*重试失败节点/)
    expect(collapsed).toContain('grid-template-rows:0fr')
  })
  it.each(['en', 'zh-Hans'] as const)('interleaves child tasks and operations chronologically at the same row level in %s', async language => {
    const html = await renderTurn(language, [
      { id: 'last', type: 'intermediate', status: 'completed', timestamp: 5, content: '集中交付修订报告' },
      { id: 'coordination', type: 'tool', toolName: 'Read', status: 'completed', timestamp: 1, displayName: '读取冻结资料' },
      { id: 'revision', type: 'status', status: 'running', timestamp: 4,
        taskNode: { title: '修订报告', sessionId: 'revision-worker', stateLabel: '运行中' } },
      { id: 'node', type: 'status', status: 'completed', timestamp: 2,
        taskNode: { title: '核对两年成本', description: '读取原始资料并核对金额。', sessionId: 'worker', stateLabel: '完成' } },
      { id: 'decision', type: 'tool', toolName: 'Read', status: 'completed', timestamp: 3, displayName: '复核金额差异' },
    ], { isComplete: true, isStreaming: false, onOpenActivityDetails: () => {} })
    expect(html).not.toContain('data-work-group')
    expect(html).not.toContain('子代理工作')
    expect(html).not.toContain('协调与复核')
    expect(html).not.toContain('历史尝试')
    expect(html).not.toContain('读取原始资料并核对金额。')
    expect(html).toContain('lucide-users-round')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?核对两年成本/)
    const ordered = ['读取冻结资料', '核对两年成本', '复核金额差异', '修订报告', '集中交付修订报告']
    for (let index = 1; index < ordered.length; index++) {
      expect(html.indexOf(ordered[index - 1]!)).toBeGreaterThan(-1)
      expect(html.indexOf(ordered[index - 1]!)).toBeLessThan(html.indexOf(ordered[index]!))
    }
  })
  it('keeps completed child results inspectable before a root response exists', async () => {
    const html = await renderTurn('zh-Hans', [{ id: 'node', type: 'status', status: 'completed', timestamp: 1,
      taskNode: { title: '核对成本', sessionId: 'worker', stateLabel: '完成' } }], { isComplete: true, isStreaming: false })
    expect(html).toContain('核对成本')
    expect(html).not.toContain('data-work-group="coordinator"')
  })
  it.each(['en', 'zh-Hans'] as const)('keeps the parent assignment visible above collapsed work in %s', async language => {
    const html = await renderTurn(language, [{
      id: 'assignment', type: 'task-context', status: 'completed', timestamp: 1, content: 'internal-protocol',
      taskContext: { kind: 'assignment', description: '比较成本与风险', instruction: '独立核对原始金额。发现差异后交回修正。提交 values.research。' },
    }, { id: 'read', type: 'tool', status: 'completed', timestamp: 2, toolName: 'Read' }], { isComplete: true, isStreaming: false, expanded: false })
    expect(html).toContain('data-task-assignment-summary')
    expect(html).toContain(resources[language].translation['chat.taskContext.assignment.fromParent'])
    expect(html).toContain('独立核对原始金额。 发现差异后交回修正。')
    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('data-task-assignment-summary')).toBeLessThan(html.indexOf('aria-expanded="false"'))
    expect(html).not.toMatch(/internal-protocol|values\.research/)
    expect(html.match(/<p[^>]*data-task-assignment-summary[^>]*>[\s\S]*?<\/p>/)?.[0]).not.toContain('比较成本与风险')
  })
  it('distinguishes pending, failed and completed subagent status rows', async () => {
    const html = await renderTurn('zh-Hans', [
      { id: 'pending', type: 'status', status: 'pending', content: '核验修订结果 · 待处理', timestamp: 1 },
      { id: 'failed', type: 'status', status: 'error', content: '修正报告 · 失败', timestamp: 2 },
      { id: 'done', type: 'status', status: 'completed', content: '读取资料 · 完成', timestamp: 3 },
    ])
    expect(html).toContain('lucide-circle ')
    expect(html).toContain('lucide-circle-x')
    expect(countOccurrences(html, 'lucide-circle-check')).toBe(1)
  })
  it.each(['en', 'zh-Hans'] as const)('keeps internal task context in a compact status row without raw protocol in %s', async language => {
    const activity: ActivityItem = {
      id: 'task-context', type: 'task-context', status: 'completed', timestamp: 1,
      content: 'Conductor checkpoint (batch-complete). {"runId":"internal-run-123"}',
      taskContext: { kind: 'coordination' },
    }
    const html = await renderTurn(language, [activity, {
      id: 'read', type: 'tool', status: 'completed', timestamp: 2, toolName: 'Read',
    }], { isComplete: true, isStreaming: false })
    expect(html).toContain(resources[language].translation['chat.taskContext.coordination.title'])
    expect(html).toContain(resources[language].translation['chat.taskContext.coordination.description'])
    expect(html).toContain('lucide-circle-check')
    expect(html).not.toContain('Conductor checkpoint')
    expect(html).not.toContain('internal-run-123')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('<article')
    expect(activity.type).toBe('task-context')
    expect(activity.content).toContain('internal-run-123')
  })

  it.each(['en', 'zh-Hans'] as const)('provides a folded, fully readable assignment brief without raw fields in %s', async language => {
    const html = await renderTurn(language, [{
      id: 'assignment', type: 'task-context', status: 'completed', timestamp: 1,
      content: 'Apply these skills: [skill:deep-research] {"hash":"internal-hash","depends_on":["cost"]}',
      taskContext: { kind: 'assignment', description: '核对两年成本', briefing: {
        requirements: ['关键金额须经独立审查'], sources: ['已冻结的原始成本资料'], limits: ['只读资料，不修改文件'],
      } },
    }, { id: 'read', type: 'tool', status: 'completed', timestamp: 2, toolName: 'Read' }], { isComplete: true, isStreaming: false })
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('<summary')
    expect(html).toContain('lucide-circle-check')
    for (const text of ['核对两年成本', '关键金额须经独立审查', '已冻结的原始成本资料', '只读资料，不修改文件']) expect(html).toContain(text)
    expect(html).toContain(resources[language].translation['tasks.research.sources'])
    expect(html).not.toMatch(/internal-hash|depends_on|Apply these skills|查看原始记录/)
  })

  it('keeps structured research submissions readable while preserving rejected verdicts', async () => {
    const html = await renderTurn('zh-Hans', [
      { id: 'output', type: 'tool', status: 'completed', timestamp: 1, toolName: 'mcp__session__submit_task_output',
        displayName: '提交研究记录', intent: '登记核对后的成本与资料限制', toolInput: { values: { research: { claims: [{ id: 'cost', evidenceIds: ['e-cost'], sourceVersion: 'internal-hash' }] } } } },
      { id: 'verdict', type: 'tool', status: 'error', timestamp: 2, toolName: 'mcp__session__submit_task_node_verdict',
        displayName: '提交核验结果', intent: '核验成本记录', toolInput: { result: 'pass', runId: 'internal-run' }, error: '此会话没有验证运行' },
    ], { isComplete: true, isStreaming: false })
    expect(html).toContain('提交研究记录')
    expect(html).toContain('登记核对后的成本与资料限制')
    expect(html).toContain('data-slot="activity-error-badge"')
    expect(html).toContain('错误')
    expect(html).not.toMatch(/sourceVersion|internal-hash|internal-run|evidenceIds/)
  })

  it('localizes the live header and renders one spinner for an intermediate row', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'intermediate-1',
      type: 'intermediate',
      status: 'running',
      timestamp: 1,
      content: '',
    }])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
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
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
  })

  it('keeps one standalone status before the first visible activity', async () => {
    const html = await renderTurn('zh-Hans', [])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
  })

  it('lets the chat work status own loading before the first tool and between tools', async () => {
    const cases: ActivityItem[][] = [
      [],
      [{ id: 'thinking', type: 'thinking', status: 'running', timestamp: 1, content: '' }],
      [{ id: 'intermediate', type: 'intermediate', status: 'running', timestamp: 1, content: '' }],
      [{ id: 'read', type: 'tool', toolName: 'Read', status: 'completed', timestamp: 1 }],
    ]
    for (const expanded of [false, true]) {
      for (const activities of cases) {
        const html = await renderTurn('zh-Hans', activities, { hasExternalWorkStatus: true, expanded })
        expect(html).not.toContain('data-status="working"')
        expect(html).not.toContain('data-thinking-slot')
        if (activities.some(activity => activity.type === 'tool')) expect(html).toContain('读取文件')
      }
    }
    const buffering = await renderTurn('zh-Hans', [], { hasExternalWorkStatus: true,
      response: { text: '', isStreaming: true } })
    expect(buffering).not.toContain('data-status="working"')
    expect(buffering).not.toContain('data-thinking-slot')
  })

  it('retains real running tool indicators when the parent owns the generic status', async () => {
    const html = await renderTurn('zh-Hans', [{ id: 'read', type: 'tool', toolName: 'Read', status: 'running', timestamp: 1 }], {
      hasExternalWorkStatus: true, expanded: true,
    })
    expect(html).toContain('读取文件')
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
    expect(html).not.toContain('data-thinking-slot')
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
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
  })

  it('does not add a second status below a visible running thinking row', async () => {
    const html = await renderTurn('zh-Hans', [{
      id: 'thinking-1',
      type: 'thinking',
      status: 'running',
      timestamp: 1,
    }])

    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
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
    // A transient progress note and the answer card are separate presences.
    expect(src).toContain("key={`stream-${response.streamKey ?? response.messageId ?? 'response'}`}")
    expect(presence).toContain("'merge-into-chain'")
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
    expect(countOccurrences(html, 'data-status="working"')).toBe(0)
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

it('reserves one status slot across tool/awaiting cycles and removes it on completion', async () => {
  const tool: ActivityItem = { id: 'fetch', type: 'tool', toolName: 'WebFetch', status: 'running', timestamp: 1 }
  for (const status of ['running', 'completed', 'running', 'completed'] as const) {
    const html = await renderTurn('zh-Hans', [{ ...tool, status }])
    expect(countOccurrences(html, 'data-thinking-slot=""')).toBe(1)
    expect(html).toContain(`visibility:${status === 'completed' ? 'visible' : 'hidden'}`)
    if (status === 'running') expect(html).toContain('data-thinking-slot="" aria-hidden="true"')
  }
  const completed = await renderTurn('zh-Hans', [{ ...tool, status: 'completed' }], { isComplete: true, isStreaming: false })
  expect(completed).not.toContain('data-thinking-slot')
})

it('renders one thinking label after tools even when multiple SDK placeholders overlap', async () => {
  const tool: ActivityItem = { id: 'fetch', type: 'tool', toolName: 'WebFetch', status: 'completed', timestamp: 1 }
  const placeholders: ActivityItem[] = [
    { id: 'thinking', type: 'thinking', status: 'running', content: '', timestamp: 2 },
    { id: 'intermediate', type: 'intermediate', status: 'running', content: '  ', timestamp: 3 },
  ]
  for (const rows of [[tool], [tool, placeholders[0]!], [tool, ...placeholders], [tool, placeholders[1]!]]) {
    const html = await renderTurn('zh-Hans', rows)
    expect(countOccurrences(html, '思考中…')).toBe(1)
    expect(countOccurrences(html, 'data-status="working"')).toBe(1)
  }
})

it('shows 待澄清 and three centered accent dots while a clarification is waiting', async () => {
  const tool: ActivityItem = { id: 'clarify', type: 'tool', toolName: 'clarify', status: 'completed', timestamp: 1 }
  const waiting = await renderTurn('zh-Hans', [tool], { isComplete: true, isStreaming: false, expanded: false, awaitingClarification: true })
  expect(waiting).toContain('data-work-status="awaiting-clarification"')
  expect(waiting).toContain('待澄清')
  expect(waiting).not.toContain('步骤已完成')
  expect(waiting).toContain('data-clarification-ellipsis')
  expect(waiting).toContain('flex-row items-center justify-center')
  expect(countOccurrences(waiting, 'rounded-full bg-accent')).toBe(3)
  const settled = await renderTurn('zh-Hans', [tool], { isComplete: true, isStreaming: false, expanded: false })
  expect(settled).toContain('步骤已完成')
  expect(settled).not.toContain('data-clarification-ellipsis')
  expect(settled).not.toContain('待澄清')
})

it('does not repeat a thinking header in the status slot', async () => {
  const html = await renderTurn('zh-Hans', [{
    id: 'status', type: 'status', status: 'completed', timestamp: 1,
  }])
  expect(countOccurrences(html, '思考中…')).toBe(1)
})

it('shows model reasoning inside the process chain while it is still running', async () => {
  const live = await renderTurn('zh-Hans', [{
    id: 'think', type: 'thinking', status: 'running', content: '先整理结构', timestamp: Date.now(),
  }], { expanded: true })
  const chain = live.slice(live.indexOf('data-process-chain'))
  expect(chain).toContain('data-thinking-live')
  expect(chain).not.toContain('data-thinking-preview')
  expect(chain).toContain('data-thinking-step')
  expect(chain).toContain('深度思考中')
  expect(chain).toContain('data-text="深度思考中"')
  expect(chain).toContain('thinking-text-shimmer')
  expect(chain).not.toContain('已深度思考')
  expect(chain).not.toContain('先整理结构')
  expect(chain).not.toContain('thinking-preview-enter')
  expect(chain).not.toContain('is-enter-start')
  expect(chain).not.toContain('line-clamp-2')
  expect(chain).not.toContain('lucide-message-circle-dashed')
  expect(live).not.toContain('data-thinking-done')
  expect(live).not.toContain('<details')

  const english = await renderTurn('en', [{
    id: 'think', type: 'thinking', status: 'running', content: 'Outline the structure first', timestamp: Date.now(),
  }], { expanded: true })
  const englishChain = english.slice(english.indexOf('data-process-chain'))
  expect(englishChain).toContain('Thinking deeply')
  expect(englishChain).toContain('data-text="Thinking deeply"')
  expect(englishChain).not.toContain('Outline the structure first')
  expect(englishChain).not.toContain('Thought deeply')
})

it('keeps thinking and intermediate rounds inside the chain and the final reply below it', async () => {
  const activities: ActivityItem[] = [
    { id: 'think-1', type: 'thinking', status: 'completed', content: '先看安装情况', timestamp: 1 },
    { id: 'note-1', type: 'intermediate', status: 'completed', content: 'Zen 1.23.2b installed, and there are two fresh crash reports.', timestamp: 2 },
    { id: 'tool-1', type: 'tool', status: 'completed', toolName: 'Bash', intent: '检查 Zen 安装', timestamp: 3 },
    { id: 'think-2', type: 'thinking', status: 'completed', content: '签名已经失效', timestamp: 4 },
    { id: 'note-2', type: 'intermediate', status: 'completed', content: 'Crash reason: Code Signature Invalid', timestamp: 5 },
    { id: 'tool-2', type: 'tool', status: 'completed', toolName: 'Bash', intent: '校验应用签名', timestamp: 6 },
  ]
  const html = await renderTurn('zh-Hans', activities, {
    isComplete: true,
    isStreaming: false,
    expanded: true,
    onOpenActivityDetails: () => {},
    response: { text: 'Key finding: spctl says the seal is missing.', isStreaming: false, messageId: 'final' },
  })
  const chainStart = html.indexOf('data-process-chain')
  const replyStart = html.indexOf('Key finding: spctl says the seal is missing.')
  expect(chainStart).toBeGreaterThan(-1)
  expect(replyStart).toBeGreaterThan(chainStart)
  const chain = html.slice(chainStart, replyStart)
  expect(chain).toContain('已深度思考')
  expect(chain).toContain('data-thinking-preview="done"')
  expect(chain).not.toContain('thinking-text-shimmer')
  expect(chain).not.toContain('is-enter-start')
  expect(chain).not.toContain('is-exit')
  expect(chain).not.toContain('data-thinking-swap')
  expect(chain).toContain('先看安装情况')
  expect(chain).toContain('签名已经失效')
  expect(chain).toContain('opacity-60')
  expect(chain).toContain('truncate')
  expect(chain).toContain('lucide-message-circle-dashed')
  expect(chain).not.toContain('lucide lucide-circle ')
  expect(chain).toContain('Zen 1.23.2b installed, and there are two fresh crash reports.')
  expect(chain).toContain('Crash reason: Code Signature Invalid')
  expect(countOccurrences(chain, 'data-thinking-step=""')).toBe(2)
  expect(countOccurrences(chain, 'data-process-step=""')).toBe(4)
  expect(html.slice(replyStart)).not.toContain('data-thinking-step')
  expect(html).not.toContain('data-thinking-done')
  expect(html).not.toContain('<details')
  expect(countOccurrences(chain, 'role="button"')).toBeGreaterThanOrEqual(2)
})

it('collapses a long intermediate narrative to one process step instead of the prose', async () => {
  const prose = '让我先探索项目结构。\n\n' + '继续读配置与入口。'.repeat(20)
  const html = await renderTurn('zh-Hans', [
    { id: 'note', type: 'intermediate', status: 'completed', content: prose, timestamp: 1 },
    { id: 'tool', type: 'tool', status: 'completed', toolName: 'Read', intent: '读入口', timestamp: 2 },
  ], {
    isComplete: true,
    isStreaming: false,
    expanded: true,
    onOpenActivityDetails: () => {},
    response: { text: '结论写在这里。', isStreaming: false, messageId: 'final' },
  })
  const chain = html.slice(html.indexOf('data-process-chain'), html.indexOf('结论写在这里。'))
  expect(chain).toContain('已深度思考')
  expect(chain).not.toContain('继续读配置与入口。继续读配置与入口。')
  expect(chain).toContain('data-process-step')
  expect(html).not.toContain('<details')
  expect(html.slice(html.indexOf('结论写在这里。'))).toContain('结论写在这里。')
})

it('hides the streaming transcript, then shows a one-line summary only when the block has text', async () => {
  const opening = '甲'.repeat(80)
  const latest = '最新判断'
  const live = await renderTurn('zh-Hans', [{
    id: 'think-live', type: 'thinking', status: 'running', timestamp: 1,
    content: `先看安装情况。\n${opening}${latest}`,
  }], { expanded: true })
  const liveStep = live.slice(live.indexOf('data-thinking-step'))
  expect(liveStep).not.toContain('data-thinking-preview')
  expect(liveStep).toContain('深度思考中')
  expect(liveStep).toContain('thinking-text-shimmer')
  expect(liveStep).toContain('thinking-label-swap')
  expect(liveStep).not.toContain(latest)
  expect(liveStep).not.toContain(opening)
  expect(liveStep).not.toContain('先看安装情况')
  expect(liveStep).not.toContain('line-clamp-2')
  expect(liveStep).not.toContain('items-start')

  const settled = await renderTurn('zh-Hans', [{
    id: 'think-done', type: 'thinking', status: 'completed', timestamp: 1,
    content: `**先看**安装情况。\n${opening}${latest}`,
  }], { isComplete: true, isStreaming: false, expanded: true, onOpenActivityDetails: () => {} })
  const doneStep = settled.slice(settled.indexOf('data-thinking-step'))
  expect(doneStep).toContain('data-thinking-preview="done"')
  expect(doneStep).toContain('已深度思考')
  expect(doneStep).not.toContain('深度思考中')
  expect(doneStep).not.toContain('thinking-text-shimmer')
  expect(doneStep).not.toContain('is-enter-start')
  expect(doneStep).not.toContain('thinking-preview-enter')
  expect(doneStep).toContain('先看安装情况')
  expect(doneStep).toContain(opening)
  expect(doneStep).not.toContain('**先看**')
  expect(doneStep).toContain('lucide-message-circle-dashed')
  expect(doneStep).toContain('role="button"')
  expect(doneStep).toContain('truncate')

  const redacted = await renderTurn('zh-Hans', [{
    id: 'think-empty', type: 'thinking', status: 'completed', timestamp: 1, content: '  \n',
  }], { isComplete: true, isStreaming: false, expanded: true, onOpenActivityDetails: () => {} })
  expect(redacted).toContain('已深度思考')
  expect(redacted).toContain('lucide-message-circle-dashed')
  expect(redacted).not.toContain('data-thinking-preview')
  expect(redacted).not.toContain('role="button"')
  expect(redacted).not.toContain('lucide-circle')
})
