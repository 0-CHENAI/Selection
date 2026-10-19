import * as React from 'react'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import testI18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import zh from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { TaskProgressCard, TaskTurnSummary } from '../TaskProgressCard'
import type { TodoItem } from '../TurnCard'
import {
  EMPTY_TASK_CARD_MEMORY,
  isTaskCardDocked,
  latestTodoList,
  readTaskCardMemory,
  reduceTaskCardMemory,
  taskStepProgress,
  todoRailForTurn,
  writeTaskCardMemory,
} from '../task-progress'

await testI18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  fallbackLng: 'en',
  keySeparator: false,
  resources: {
    en: { translation: en },
    'zh-Hans': { translation: zh },
  },
  interpolation: { escapeValue: false },
})

const mixed: TodoItem[] = [
  { id: 'facts', content: '确认事实', status: 'completed' },
  { id: 'sources', content: '核对出处', status: 'completed' },
  { id: 'summary', content: '撰写摘要', status: 'in_progress', activeForm: '正在撰写摘要' },
  { id: 'appendix', content: '整理附录', status: 'pending' },
  { id: 'poem', content: '写一首秋天的小诗', status: 'pending' },
  { id: 'close', content: '用一句话总结', status: 'pending' },
]

function renderCard(node: React.ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{node}</I18nextProvider>)
}

describe('task step progress', () => {
  test('counts the in-progress step and switches to a completed summary', () => {
    expect(taskStepProgress(mixed)).toEqual({
      current: 3,
      total: 6,
      title: '正在撰写摘要',
      allCompleted: false,
    })
    const done = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: undefined }))
    expect(taskStepProgress(done)).toEqual({ current: 6, total: 6, title: '', allCompleted: true })
    expect(taskStepProgress([])).toEqual({ current: 0, total: 0, title: '', allCompleted: false })
  })

  test('uses the next unfinished step when nothing is in progress', () => {
    const stopped = mixed.map(item => item.status === 'in_progress'
      ? { ...item, status: 'interrupted' as const, activeForm: undefined }
      : item)
    expect(taskStepProgress(stopped)).toMatchObject({ current: 3, total: 6, title: '撰写摘要', allCompleted: false })
  })
})

describe('which turn keeps the rail', () => {
  test('docks only the latest list and leaves older turns as a summary', () => {
    const turns = [
      { type: 'user' },
      { type: 'assistant', todos: mixed.slice(0, 2) },
      { type: 'assistant', todos: [] },
      { type: 'assistant', todos: mixed },
    ]
    expect(latestTodoList(turns)).toEqual({ index: 3, todos: mixed })
    expect(todoRailForTurn({ enabled: true, isLatest: true, docked: true, hasTodos: true })).toBe('hidden')
    expect(todoRailForTurn({ enabled: true, isLatest: false, docked: true, hasTodos: true })).toBe('summary')
    expect(todoRailForTurn({ enabled: true, isLatest: true, docked: false, hasTodos: true })).toBe('summary')
    expect(todoRailForTurn({ enabled: false, isLatest: true, docked: true, hasTodos: true })).toBe('full')
    expect(latestTodoList([{ type: 'assistant' }])).toBeNull()
  })
})

describe('session memory', () => {
  test('remembers collapse, auto-collapses on completion, and hides only that finished list', () => {
    const storage = new Map<string, string>()
    const box = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    }
    let memory = reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'hydrate',
      memory: null,
      allCompleted: false,
    })
    expect(memory.collapsed).toBe(false)
    memory = reduceTaskCardMemory(memory, { type: 'toggle' })
    writeTaskCardMemory('session-a', memory, box)
    expect(readTaskCardMemory('session-a', box)?.collapsed).toBe(true)
    expect(readTaskCardMemory('session-b', box)).toBeNull()

    memory = reduceTaskCardMemory(memory, { type: 'toggle' })
    memory = reduceTaskCardMemory(memory, { type: 'complete' })
    expect(memory.collapsed).toBe(true)
    expect(isTaskCardDocked(memory, 'turn-1')).toBe(true)

    memory = reduceTaskCardMemory(memory, { type: 'dismiss', key: 'turn-1' })
    expect(isTaskCardDocked(memory, 'turn-1')).toBe(false)
    expect(isTaskCardDocked(memory, 'turn-2')).toBe(true)
    memory = reduceTaskCardMemory(memory, { type: 'resume', key: 'turn-1' })
    expect(isTaskCardDocked(memory, 'turn-1')).toBe(true)

    const stored = reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'session',
      memory: { collapsed: true, dismissedKey: 'turn-9' },
      allCompleted: false,
    })
    expect(stored).toEqual({ collapsed: true, dismissedKey: 'turn-9' })
    expect(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'hydrate',
      memory: null,
      allCompleted: true,
    }).collapsed).toBe(true)
    expect(readTaskCardMemory(null, box)).toBeNull()
    writeTaskCardMemory(null, memory, box)
  })
})

describe('task card markup', () => {
  test('collapsed in-progress row shows the active title and 3/6', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const html = renderCard(
      <TaskProgressCard todos={mixed} expanded={false} onExpandedChange={() => {}} />,
    )
    expect(html).toContain('正在撰写摘要')
    expect(html).toContain('3/6')
    expect(html).toContain('data-task-card-expanded="false"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('grid-template-rows:0fr')
    expect(html).toContain('max-h-[40vh]')
    expect(html).toContain('data-slot="rail-toc"')
    expect(html).toContain(zh['taskCard.label'])
    expect(html.includes(zh['taskCard.dismiss'])).toBe(false)
    expect(html.includes('data-testid="chat-scroll-to-bottom"')).toBe(false)
  })

  test('expanded card keeps the rail, and a finished list can be closed', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const done = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: undefined }))
    const html = renderCard(
      <TaskProgressCard
        todos={done}
        expanded
        onExpandedChange={() => {}}
        onDismiss={() => {}}
        showScrollToBottom
        onScrollToBottom={() => {}}
      />,
    )
    expect(html).toContain('6/6 已完成')
    expect(html).toContain('data-task-card-state="complete"')
    expect(html).toContain('data-task-card-expanded="true"')
    expect(html).toContain('grid-template-rows:1fr')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(zh['taskCard.dismiss'])
    expect(html).toContain('data-testid="chat-scroll-to-bottom"')
    expect(html).toContain(zh['chat.scrollToBottom'])
    expect(html).toContain('rounded-[16px]')
    expect(html).toContain('shadow-minimal')
    expect(html).toContain('data-slot="rail-toc"')
    const compact = renderCard(
      <TaskProgressCard todos={done} expanded={false} onExpandedChange={() => {}} compact />,
    )
    expect(compact).toContain('rounded-[12px]')
  })

  test('older turns keep a one-line summary until it is opened', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const closed = renderCard(<TaskTurnSummary todos={mixed} />)
    expect(closed).toContain('data-task-turn-summary')
    expect(closed).toContain(zh['taskCard.review'])
    expect(closed).toContain('正在撰写摘要')
    expect(closed).toContain('3/6')
    expect(closed.includes('data-slot="rail-toc"')).toBe(false)
    const open = renderCard(<TaskTurnSummary todos={mixed} defaultExpanded />)
    expect(open).toContain('data-slot="rail-toc"')
    expect(open).toContain('确认事实')
  })

  test('does not replace the rail drawing', () => {
    const rail = readFileSync(new URL('../../ui/rail-toc.tsx', import.meta.url), 'utf8')
    const card = readFileSync(new URL('../TaskProgressCard.tsx', import.meta.url), 'utf8')
    expect(rail).toContain('useReducedMotion')
    expect(rail).toContain('strokeDasharray="2 5"')
    expect(rail).toContain('M2 4h12M2 8h8M2 12h10')
    expect(card).toContain('M2 4h12M2 8h8M2 12h10')
    expect(card).toContain('max-h-[40vh]')
    expect(card).toContain('useReducedMotion')
  })
})
