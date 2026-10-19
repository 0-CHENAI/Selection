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
  TASK_CARD_FADE_MS,
  isTaskCardVisible,
  latestTodoList,
  readTaskCardMemory,
  reduceTaskCardMemory,
  shouldFadeTaskCard,
  snapshotFromTodos,
  taskStepProgress,
  todoRailForTurn,
  writeTaskCardMemory,
  type TaskCardMemory,
  type TaskListSnapshot,
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

const doneItems: TodoItem[] = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: undefined }))

function renderCard(node: React.ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{node}</I18nextProvider>)
}

function snap(key: string, todos: readonly TodoItem[], generationEnded = false): TaskListSnapshot {
  return snapshotFromTodos(key, todos, generationEnded)
}

function list(memory: TaskCardMemory, snapshot: TaskListSnapshot, userTurnAfterList = false) {
  return reduceTaskCardMemory(memory, { type: 'list', snapshot, userTurnAfterList })
}

function appear(snapshot: TaskListSnapshot) {
  return reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
    type: 'hydrate',
    memory: null,
    snapshot,
    userTurnAfterList: false,
  })
}

describe('task step progress', () => {
  test('counts the in-progress step and switches to a completed summary', () => {
    expect(taskStepProgress(mixed)).toEqual({
      current: 3,
      total: 6,
      title: '正在撰写摘要',
      allCompleted: false,
    })
    expect(taskStepProgress(doneItems)).toEqual({ current: 6, total: 6, title: '', allCompleted: true })
    expect(taskStepProgress([])).toEqual({ current: 0, total: 0, title: '', allCompleted: false })
  })

  test('uses the next unfinished step when nothing is in progress', () => {
    const stopped = mixed.map(item => item.status === 'in_progress'
      ? { ...item, status: 'interrupted' as const, activeForm: undefined }
      : item)
    expect(taskStepProgress(stopped)).toMatchObject({ current: 3, total: 6, title: '撰写摘要', allCompleted: false })
    expect(snapshotFromTodos('turn-1', stopped, false).interrupted).toBe(true)
    expect(snapshotFromTodos('turn-1', mixed, true).interrupted).toBe(true)
    expect(snapshotFromTodos('turn-1', mixed, false).interrupted).toBe(false)
    expect(snapshotFromTodos('turn-1', doneItems, true).interrupted).toBe(false)
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

describe('floating card lifecycle', () => {
  const active = snap('turn-1', mixed)
  const done = snap('turn-1', doneItems)

  test('appears collapsed when update_task_list still has open items, and stays collapsed as it advances', () => {
    let memory = appear(active)
    expect(memory).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-1' })
    expect(isTaskCardVisible(memory)).toBe(true)
    expect(shouldFadeTaskCard(memory, false)).toBe(false)

    const advanced = mixed.map((item, index) => index < 3
      ? { ...item, status: 'completed' as const, activeForm: undefined }
      : index === 3
        ? { ...item, status: 'in_progress' as const, activeForm: '正在整理附录' }
        : item)
    memory = list(memory, snap('turn-1', advanced))
    expect(memory).toMatchObject({ phase: 'active', expanded: false })

    memory = reduceTaskCardMemory(memory, { type: 'expand', expanded: true })
    memory = list(memory, snap('turn-1', advanced))
    expect(memory.expanded).toBe(true)

    const fresh = list(memory, snap('turn-2', mixed))
    expect(fresh).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-2' })
    expect(appear(done).phase).toBe('hidden')
    expect(list(EMPTY_TASK_CARD_MEMORY, done).phase).toBe('hidden')
  })

  test('holds the completed capsule until the fade, and waits out hover or an open panel', () => {
    expect(TASK_CARD_FADE_MS).toBe(4000)
    let memory = list(appear(active), done)
    expect(memory.phase).toBe('complete')
    expect(isTaskCardVisible(memory)).toBe(true)
    expect(shouldFadeTaskCard(memory, false)).toBe(true)

    memory = reduceTaskCardMemory(memory, { type: 'expand', expanded: true })
    expect(shouldFadeTaskCard(memory, false)).toBe(false)
    expect(reduceTaskCardMemory(memory, { type: 'fade' }).phase).toBe('complete')

    memory = reduceTaskCardMemory(memory, { type: 'collapse' })
    expect(shouldFadeTaskCard(memory, true)).toBe(false)
    expect(shouldFadeTaskCard(memory, false)).toBe(true)
    memory = reduceTaskCardMemory(memory, { type: 'fade' })
    expect(memory.phase).toBe('hidden')
    expect(isTaskCardVisible(memory)).toBe(false)

    const followedUp = reduceTaskCardMemory(list(appear(active), done), {
      type: 'user-message',
      snapshot: done,
    })
    expect(followedUp.phase).toBe('hidden')
    expect(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'hydrate',
      memory: null,
      snapshot: done,
      userTurnAfterList: true,
    }).phase).toBe('hidden')
  })

  test('a manual close hides this round until a new incomplete item arrives', () => {
    let memory = reduceTaskCardMemory(appear(active), { type: 'dismiss', snapshot: active })
    expect(memory.phase).toBe('hidden')
    expect(memory.dismissedKey).toBe('turn-1')

    const progressed = mixed.map((item, index) => index === 2
      ? { ...item, status: 'completed' as const, activeForm: undefined }
      : index === 3
        ? { ...item, status: 'in_progress' as const, activeForm: '正在整理附录' }
        : item)
    memory = list(memory, snap('turn-1', progressed))
    expect(memory.phase).toBe('hidden')

    const added = [...progressed, { id: 'extra', content: '补一个新步骤', status: 'pending' as const }]
    memory = list(memory, snap('turn-1', added))
    expect(memory).toMatchObject({ phase: 'active', expanded: false, dismissedKey: null })

    const reopened = mixed.map(item => item.id === 'facts'
      ? { ...item, status: 'pending' as const }
      : item.status === 'in_progress'
        ? { ...item, status: 'completed' as const, activeForm: undefined }
        : item)
    const closed = reduceTaskCardMemory(appear(active), { type: 'dismiss', snapshot: active })
    expect(list(closed, snap('turn-1', reopened)).phase).toBe('active')
  })

  test('interruption keeps the capsule until it is closed', () => {
    const stopped = mixed.map(item => item.status === 'in_progress'
      ? { ...item, status: 'interrupted' as const, activeForm: undefined }
      : item)
    const snapshot = snap('turn-1', stopped, true)
    let memory = list(appear(active), snapshot)
    expect(memory.phase).toBe('interrupted')
    expect(isTaskCardVisible(memory)).toBe(true)
    expect(shouldFadeTaskCard(memory, false)).toBe(false)
    memory = reduceTaskCardMemory(memory, { type: 'user-message', snapshot })
    expect(memory.phase).toBe('interrupted')
    memory = reduceTaskCardMemory(memory, { type: 'dismiss', snapshot })
    expect(memory.phase).toBe('hidden')
  })

  test('each session restores its own open or dismissed in-progress capsule', () => {
    const storage = new Map<string, string>()
    const box = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    }
    const open: TaskCardMemory = {
      expanded: true,
      dismissedKey: null,
      dismissedIds: [],
      dismissedIncompleteIds: [],
      phase: 'active',
      listKey: 'turn-1',
    }
    writeTaskCardMemory('session-a', open, box)
    expect(readTaskCardMemory('session-a', box)).toEqual(open)
    expect(readTaskCardMemory('session-b', box)).toBeNull()

    const restored = reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'session',
      memory: readTaskCardMemory('session-a', box),
      snapshot: active,
      userTurnAfterList: false,
    })
    expect(restored).toMatchObject({ phase: 'active', expanded: true, listKey: 'turn-1' })

    const dismissed = reduceTaskCardMemory(appear(active), { type: 'dismiss', snapshot: active })
    writeTaskCardMemory('session-b', dismissed, box)
    const stillClosed = reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'session',
      memory: readTaskCardMemory('session-b', box),
      snapshot: active,
      userTurnAfterList: false,
    })
    expect(stillClosed.phase).toBe('hidden')

    const finished: TaskCardMemory = { ...open, phase: 'complete', expanded: false }
    const dropped = reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
      type: 'session',
      memory: finished,
      snapshot: done,
      userTurnAfterList: false,
    })
    expect(dropped.phase).toBe('hidden')

    writeTaskCardMemory('session-c', { ...open, expanded: false }, box)
    box.setItem('craft-task-card:session-c', JSON.stringify({ collapsed: true, dismissedKey: 'turn-9' }))
    expect(readTaskCardMemory('session-c', box)).toMatchObject({
      expanded: false,
      dismissedKey: 'turn-9',
      phase: 'hidden',
    })
    expect(readTaskCardMemory(null, box)).toBeNull()
    writeTaskCardMemory(null, open, box)
    expect(reduceTaskCardMemory(open, { type: 'toggle' }).expanded).toBe(false)
    expect(reduceTaskCardMemory({ ...open, phase: 'hidden' }, { type: 'toggle' }).phase).toBe('hidden')
  })
})

describe('task card markup', () => {
  test('collapsed capsule shows the active title once, with 3/6, and no rail', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const html = renderCard(
      <TaskProgressCard todos={mixed} phase="active" expanded={false} onExpandedChange={() => {}} onDismiss={() => {}} />,
    )
    expect(html).toContain('正在撰写摘要')
    expect(html.match(/正在撰写摘要/g)).toHaveLength(2)
    expect(html).toContain('3/6')
    expect(html).toContain('data-task-card-expanded="false"')
    expect(html).toContain('data-task-card-state="active"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('absolute')
    expect(html).toContain('rounded-full')
    expect(html).toContain('max-w-[min(420px,calc(100%-2.75rem))]')
    expect(html).toContain('backdrop-blur-md')
    expect(html).toContain('shadow-minimal')
    expect(html).toContain(zh['taskCard.label'])
    expect(html).toContain(zh['taskCard.dismiss'])
    expect(html.includes('data-slot="rail-toc"')).toBe(false)
    expect(html.includes('data-slot="rail-toc-title"')).toBe(false)
    expect(html.includes('max-h-[40vh]')).toBe(false)
    expect(html.includes('data-testid="chat-scroll-to-bottom"')).toBe(false)
  })

  test('expanded panel keeps a single rail and does not repeat its heading', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const html = renderCard(
      <TaskProgressCard
        todos={mixed}
        phase="active"
        expanded
        onExpandedChange={() => {}}
        onDismiss={() => {}}
        showScrollToBottom
        onScrollToBottom={() => {}}
      />,
    )
    expect(html).toContain('data-task-card-expanded="true"')
    expect(html).toContain('rounded-2xl')
    expect(html).toContain('max-h-[40vh]')
    expect(html).toContain('data-slot="rail-toc"')
    expect(html.includes('data-slot="rail-toc-title"')).toBe(false)
    expect(html.match(/正在撰写摘要/g)).toHaveLength(1)
    expect(html).toContain('data-testid="chat-scroll-to-bottom"')
    expect(html).toContain(zh['chat.scrollToBottom'])
    expect(html).toContain(zh['taskCard.dismiss'])
  })

  test('completed and interrupted capsules use their own one-line labels', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const complete = renderCard(
      <TaskProgressCard todos={doneItems} phase="complete" expanded={false} onExpandedChange={() => {}} onDismiss={() => {}} />,
    )
    expect(complete).toContain('6/6 已完成')
    expect(complete).toContain('data-task-card-state="complete"')
    expect(complete.includes('data-slot="rail-toc"')).toBe(false)

    const stopped = mixed.map(item => item.status === 'in_progress'
      ? { ...item, status: 'interrupted' as const, activeForm: undefined }
      : item)
    const interrupted = renderCard(
      <TaskProgressCard todos={stopped} phase="interrupted" expanded={false} onExpandedChange={() => {}} onDismiss={() => {}} />,
    )
    expect(interrupted).toContain('已中断 · 3/6')
    expect(interrupted).toContain('data-task-card-state="interrupted"')
    expect(interrupted.includes('正在撰写摘要')).toBe(false)
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
    expect(open).toContain('data-slot="rail-toc-title"')
    expect(open).toContain('确认事实')
  })

  test('does not replace the rail drawing', () => {
    const rail = readFileSync(new URL('../../ui/rail-toc.tsx', import.meta.url), 'utf8')
    const card = readFileSync(new URL('../TaskProgressCard.tsx', import.meta.url), 'utf8')
    expect(rail).toContain('useReducedMotion')
    expect(rail).toContain('strokeDasharray="2 5"')
    expect(rail).toContain('M2 4h12M2 8h8M2 12h10')
    expect(rail).toContain('showTitle')
    expect(card).toContain('M2 4h12M2 8h8M2 12h10')
    expect(card).toContain('max-h-[40vh]')
    expect(card).toContain('useReducedMotion')
    expect(card).toContain('TASK_CARD_FADE_MS')
  })
})
