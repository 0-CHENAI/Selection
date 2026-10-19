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
  TASK_CARD_EXIT_MS,
  isTaskCardVisible,
  latestTodoList,
  reduceTaskCardMemory,
  snapshotFromTodos,
  taskStepProgress,
  taskTurnInterrupted,
  todoRailForTurn,
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
    snapshot,
    userTurnAfterList: false,
  })
}

function session(snapshot: TaskListSnapshot, userTurnAfterList = false) {
  return reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
    type: 'session',
    snapshot,
    userTurnAfterList,
  })
}

const stopped: TodoItem[] = mixed.map(item => item.status === 'in_progress'
  ? { ...item, status: 'interrupted' as const, activeForm: undefined }
  : item)

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
    expect(taskStepProgress(stopped)).toMatchObject({ current: 3, total: 6, title: '撰写摘要', allCompleted: false })
    expect(snapshotFromTodos('turn-1', stopped, false).interrupted).toBe(true)
    expect(snapshotFromTodos('turn-1', mixed, true).interrupted).toBe(true)
    expect(snapshotFromTodos('turn-1', mixed, false).interrupted).toBe(false)
    expect(snapshotFromTodos('turn-1', doneItems, true).interrupted).toBe(false)
    expect(snapshotFromTodos('turn-1', mixed, true).generationEnded).toBe(true)
  })

  test('a settled turn with open work reads as interrupted', () => {
    expect(taskTurnInterrupted(mixed, false)).toBe(false)
    expect(taskTurnInterrupted(mixed, true)).toBe(true)
    expect(taskTurnInterrupted(stopped, false)).toBe(true)
    expect(taskTurnInterrupted(doneItems, true)).toBe(false)
  })
})

describe('which turn keeps the rail', () => {
  test('hides the current turn and summarizes only a round that was replaced', () => {
    const turns = [
      { type: 'user' },
      { type: 'assistant', todos: mixed.slice(0, 2) },
      { type: 'assistant', todos: [] as TodoItem[] },
      { type: 'assistant', todos: mixed },
    ]
    expect(latestTodoList(turns)).toEqual({ index: 3, todos: mixed })
    expect(todoRailForTurn({ enabled: true, isLatest: true, docked: true, hasTodos: true })).toBe('hidden')
    expect(todoRailForTurn({ enabled: true, isLatest: true, docked: false, hasTodos: true })).toBe('hidden')
    expect(todoRailForTurn({ enabled: true, isLatest: false, docked: true, hasTodos: true })).toBe('summary')
    expect(todoRailForTurn({ enabled: true, isLatest: false, docked: false, hasTodos: true })).toBe('summary')
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: false,
      hasTodos: true,
      superseded: true,
    })).toBe('summary')
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: true,
      hasTodos: true,
      superseded: true,
    })).toBe('hidden')
    expect(todoRailForTurn({ enabled: false, isLatest: true, docked: true, hasTodos: true })).toBe('full')
    expect(latestTodoList([{ type: 'assistant' }])).toBeNull()
  })

  test('an emptied list stays on that turn instead of flashing an older plan', () => {
    const turns = [
      { type: 'assistant', todos: mixed },
      { type: 'assistant', todos: [] as TodoItem[] },
    ]
    expect(latestTodoList(turns)).toEqual({ index: 1, todos: [] })
    expect(latestTodoList([
      { type: 'assistant', todos: mixed },
      { type: 'assistant' },
    ])).toEqual({ index: 0, todos: mixed })
  })
})

describe('floating card lifecycle', () => {
  const active = snap('turn-1', mixed)
  const done = snap('turn-1', doneItems)
  const halted = snap('turn-1', stopped, true)

  test('appears collapsed when update_task_list still has open items, and stays collapsed as it advances', () => {
    let memory = appear(active)
    expect(memory).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-1' })
    expect(isTaskCardVisible(memory)).toBe(true)

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

    const replaced = [
      { id: 'next', content: '改成另一组任务', status: 'in_progress' as const, activeForm: '正在改任务' },
      { id: 'after', content: '收尾', status: 'pending' as const },
    ]
    memory = list(memory, snap('turn-1', replaced))
    expect(memory).toMatchObject({ phase: 'active', expanded: true, listKey: 'turn-1' })

    memory = list(memory, snap('turn-1', []))
    expect(memory.phase).toBe('hidden')
    memory = list(memory, snap('turn-1', replaced))
    expect(memory).toMatchObject({ phase: 'active', expanded: false })

    const fresh = list(memory, snap('turn-2', mixed))
    expect(fresh).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-2' })
    expect(appear(done).phase).toBe('hidden')
    expect(list(EMPTY_TASK_CARD_MEMORY, done).phase).toBe('hidden')
  })

  test('keeps the completed capsule until the next message, without an inline summary', () => {
    expect(TASK_CARD_EXIT_MS).toBe(200)
    let memory = list(appear(active), done)
    expect(memory).toMatchObject({ phase: 'complete', expanded: false, listKey: 'turn-1' })
    expect(isTaskCardVisible(memory)).toBe(true)
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: true,
      hasTodos: true,
    })).toBe('hidden')

    memory = reduceTaskCardMemory(memory, { type: 'expand', expanded: true })
    expect(memory).toMatchObject({ phase: 'complete', expanded: true })
    expect(isTaskCardVisible(memory)).toBe(true)

    const followedUp = reduceTaskCardMemory(memory, { type: 'user-message', snapshot: done })
    expect(followedUp).toMatchObject({ phase: 'hidden', expanded: false })
    expect(isTaskCardVisible(followedUp)).toBe(false)
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: false,
      hasTodos: true,
      superseded: true,
    })).toBe('summary')
  })

  test('keeps an interrupted capsule until the next message', () => {
    let memory = list(appear(active), halted)
    expect(memory.phase).toBe('interrupted')
    expect(isTaskCardVisible(memory)).toBe(true)
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: true,
      hasTodos: true,
    })).toBe('hidden')
    memory = reduceTaskCardMemory(memory, { type: 'user-message', snapshot: halted })
    expect(memory.phase).toBe('hidden')
    expect(list(appear(halted), halted).phase).toBe('hidden')
  })

  test('a newer list replaces the capsule and the old turn shows the summary', () => {
    const replaced = list(list(appear(active), done), snap('turn-2', mixed))
    expect(replaced).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-2' })
    expect(isTaskCardVisible(replaced)).toBe(true)
    expect(todoRailForTurn({ enabled: true, isLatest: false, docked: true, hasTodos: true })).toBe('summary')
    expect(todoRailForTurn({ enabled: true, isLatest: true, docked: true, hasTodos: true })).toBe('hidden')
  })

  test('a new message dismisses a capsule that is still open', () => {
    const pending = list(appear(active), done)
    expect(pending.phase).toBe('complete')
    expect(reduceTaskCardMemory(pending, { type: 'user-message', snapshot: done }).phase).toBe('hidden')

    const stopping = list(appear(active), halted)
    expect(stopping.phase).toBe('interrupted')
    expect(reduceTaskCardMemory(stopping, { type: 'user-message', snapshot: halted }).phase).toBe('hidden')

    const running = appear(active)
    const afterUser = list(running, active, true)
    expect(afterUser.phase).toBe('hidden')
    expect(list(afterUser, snap('turn-2', mixed)).phase).toBe('active')
    expect(reduceTaskCardMemory(running, { type: 'toggle' }).expanded).toBe(true)
    expect(reduceTaskCardMemory({ ...running, phase: 'hidden' }, { type: 'toggle' }).phase).toBe('hidden')
  })

  test('switching to a finished session does not show the capsule', () => {
    expect(session(done).phase).toBe('hidden')
    expect(session(halted).phase).toBe('hidden')
    expect(session(snap('turn-1', mixed, true)).phase).toBe('hidden')
    expect(session(active, true).phase).toBe('hidden')

    const expanded = reduceTaskCardMemory(appear(active), { type: 'expand', expanded: true })
    const running = reduceTaskCardMemory(expanded, {
      type: 'session',
      snapshot: active,
      userTurnAfterList: false,
    })
    expect(running).toMatchObject({ phase: 'active', expanded: false, listKey: 'turn-1' })

    const returned = reduceTaskCardMemory(list(appear(active), done), {
      type: 'session',
      snapshot: done,
      userTurnAfterList: false,
    })
    expect(returned.phase).toBe('hidden')
    expect(isTaskCardVisible(returned)).toBe(false)
    expect(todoRailForTurn({
      enabled: true,
      isLatest: true,
      docked: false,
      hasTodos: true,
    })).toBe('hidden')
  })
})

describe('task card markup', () => {
  test('collapsed capsule shows the active title once, with 3/6, and no rail', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const html = renderCard(
      <TaskProgressCard todos={mixed} phase="active" expanded={false} onExpandedChange={() => {}} />,
    )
    expect(html).toContain('正在撰写摘要')
    expect(html.match(/正在撰写摘要/g)).toHaveLength(2)
    expect(html).toContain('3/6')
    expect(html).toContain('data-task-card-expanded="false"')
    expect(html).toContain('data-task-card-state="active"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('absolute')
    expect(html).toContain('border-radius:16px')
    expect(html).toContain('max-w-[min(420px,calc(100%-2.75rem))]')
    expect(html).toContain('backdrop-blur-md')
    expect(html).toContain('shadow-minimal')
    expect(html).toContain(zh['taskCard.label'])
    expect(html.includes('关闭任务进度')).toBe(false)
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
        showScrollToBottom
        onScrollToBottom={() => {}}
      />,
    )
    expect(html).toContain('data-task-card-expanded="true"')
    expect(html).toContain('border-radius:16px')
    expect(html).toContain('data-task-card-heading')
    expect(html).toContain('任务 3/6')
    expect(html).toContain('max-h-[40vh]')
    expect(html).toContain('data-slot="rail-toc"')
    expect(html.includes('data-slot="rail-toc-title"')).toBe(false)
    expect(html.match(/正在撰写摘要/g)).toHaveLength(1)
    expect(html.match(/任务 3\/6/g)).toHaveLength(1)
    expect(html).toContain('data-testid="chat-scroll-to-bottom"')
    expect(html).toContain(zh['chat.scrollToBottom'])
    expect(html.includes('关闭任务进度')).toBe(false)
  })

  test('completed and interrupted capsules use their own one-line labels', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const complete = renderCard(
      <TaskProgressCard todos={doneItems} phase="complete" expanded={false} onExpandedChange={() => {}} />,
    )
    expect(complete).toContain('6/6 已完成')
    expect(complete).toContain('data-task-card-state="complete"')
    expect(complete.includes('data-slot="rail-toc"')).toBe(false)
    expect(complete.includes('data-task-card-heading')).toBe(false)

    const donePanel = renderCard(
      <TaskProgressCard todos={doneItems} phase="complete" expanded onExpandedChange={() => {}} />,
    )
    expect(donePanel).toContain('任务 6/6')
    expect(donePanel.includes('6/6 已完成')).toBe(false)
    expect(donePanel.includes('data-slot="rail-toc-title"')).toBe(false)

    const interrupted = renderCard(
      <TaskProgressCard todos={stopped} phase="interrupted" expanded={false} onExpandedChange={() => {}} />,
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

    const settled = renderCard(<TaskTurnSummary todos={stopped} settled />)
    expect(settled).toContain('已中断 · 3/6')
    expect(settled.includes('正在撰写摘要')).toBe(false)
    const unfinished = renderCard(<TaskTurnSummary todos={mixed} settled />)
    expect(unfinished).toContain('已中断 · 3/6')
    const finished = renderCard(<TaskTurnSummary todos={doneItems} settled />)
    expect(finished).toContain('6/6 已完成')
  })

  test('toolbar capsule matches the composer row and can shrink to the ring and fraction', async () => {
    await testI18n.changeLanguage('zh-Hans')
    const html = renderCard(
      <TaskProgressCard
        todos={mixed}
        phase="active"
        expanded={false}
        onExpandedChange={() => {}}
        placement="toolbar"
        shellMaxWidth={180}
        showScrollToBottom
        onScrollToBottom={() => {}}
      />,
    )
    expect(html).toContain('data-task-card-placement="toolbar"')
    expect(html).toContain('data-task-card-cluster="natural"')
    expect(html).toContain('data-task-card-cluster="min"')
    expect(html).toContain('h-7')
    expect(html).toContain('text-xs')
    expect(html).toContain('rounded-[8px]')
    expect(html).toContain('border-radius:8px')
    expect(html).toContain('data-task-card-progress')
    expect(html).toContain('3/6')
    expect(html).toContain('size-[30px]')
    expect(html).toContain('data-toolbar-scroll="docked"')
    expect(html).not.toContain('bottom-3')
    expect(html).not.toContain('bg-success')

    const centered = renderCard(
      <TaskProgressCard
        todos={[]}
        phase="active"
        expanded={false}
        onExpandedChange={() => {}}
        placement="toolbar"
        visible={false}
        showScrollToBottom
        onScrollToBottom={() => {}}
      />,
    )
    expect(centered).toContain('data-toolbar-scroll="center"')
    expect(centered).toContain('data-testid="chat-scroll-to-bottom"')
    expect(centered).not.toContain('data-task-card=""')
    const minAt = html.indexOf('data-task-card-cluster="min"')
    const minEnd = html.indexOf('data-task-card-cluster="natural"')
    const minHtml = minAt >= 0 && minEnd > minAt ? html.slice(minAt, minEnd) : html.slice(minAt)
    expect(minHtml.includes('正在撰写摘要')).toBe(false)
    expect(minHtml).toContain('3/6')

    const open = renderCard(
      <TaskProgressCard todos={mixed} phase="active" expanded placement="toolbar" shellMaxWidth={320} onExpandedChange={() => {}} />,
    )
    expect(open).toContain('border-radius:16px')
    expect(open).toContain('data-task-card-heading')
  })

  test('does not replace the rail drawing', () => {
    const rail = readFileSync(new URL('../../ui/rail-toc.tsx', import.meta.url), 'utf8')
    const card = readFileSync(new URL('../TaskProgressCard.tsx', import.meta.url), 'utf8')
    const machine = readFileSync(new URL('../task-progress.ts', import.meta.url), 'utf8')
    expect(rail).toContain('useReducedMotion')
    expect(rail).toContain('strokeDasharray="2 5"')
    expect(rail).toContain('strokeWidth="1.25"')
    expect(rail).toContain('allComplete ? "stroke-success" : "stroke-foreground/25"')
    expect(rail).not.toContain('fill-success')
    expect(card).toContain('text-success')
    expect(card).not.toContain('bg-success')
    expect(card).not.toContain('border-success')
    expect(rail).toContain('M2 4h12M2 8h8M2 12h10')
    expect(rail).toContain('showTitle')
    expect(card).toContain('M2 4h12M2 8h8M2 12h10')
    expect(card).toContain('max-h-[40vh]')
    expect(card).toContain('useReducedMotion')
    expect(card).toContain('TASK_CARD_EXIT_MS')
    expect(card).toContain('MotionConfig')
    expect(card).toContain('reducedMotion="user"')
    expect(card).toContain('ResizeObserver')
    expect(card).toContain('bounce: 0')
    expect(card).toContain('duration: 0.32')
    expect(card).toContain('blur(4px)')
    expect(card).toContain('absolute bottom-0 left-0')
    expect(card).toContain('taskCardContentMotion')
    expect(card.includes('mode="wait"')).toBe(false)
    expect(card).toContain('items-end')
    expect(card).toContain('FIXED_RADIUS')
    expect(card).toContain('TOOLBAR_CAPSULE_RADIUS')
    expect(card).toContain('borderRadius:')
    expect(card).toContain("overflow: 'hidden'")
    expect(card.includes('layout=')).toBe(false)
    expect(card.includes('popLayout')).toBe(false)
    expect(card.includes('scale:')).toBe(false)
    expect(card.includes('taskCard.dismiss')).toBe(false)
    expect(card.includes('<X')).toBe(false)
    expect(machine.includes('TASK_CARD_HOLD_MS')).toBe(false)
    expect(machine.includes('TASK_CARD_HOLD_MAX_MS')).toBe(false)
    expect(machine.includes('shouldFadeTaskCard')).toBe(false)
    expect(machine.includes("type: 'fade'")).toBe(false)
    expect(machine.includes('dismissedKey')).toBe(false)
  })
})
