import { useEffect, useState } from 'react'
import { TaskProgressCard, TaskTurnSummary, type TodoItem } from '@craft-agent/ui'
import {
  EMPTY_TASK_CARD_MEMORY,
  TASK_CARD_FADE_MS,
  reduceTaskCardMemory,
  shouldFadeTaskCard,
  snapshotFromTodos,
  type TaskCardMemory,
} from '@craft-agent/ui/chat'
import { i18n } from '@craft-agent/shared/i18n'
import type { ComponentEntry } from './types'

const labels = ['查看 macOS 版本', '统计工作目录文件', '查看磁盘剩余空间', '写一首秋天的小诗', '计算 1 到 100 的质数和', '用一句话总结以上结果'] as const

function tasks(active: number, doneThrough = active): TodoItem[] {
  return labels.map((label, index) => ({
    id: label,
    content: label,
    status: index < doneThrough ? 'completed' : index === active ? 'in_progress' : 'pending',
    activeForm: index === active ? `正在${label}` : undefined,
  }))
}

const done = labels.map(label => ({ id: label, content: label, status: 'completed' as const }))

const interrupted: TodoItem[] = labels.map((label, index) => ({
  id: label,
  content: label,
  status: index < 2 ? 'completed' : index === 2 ? 'interrupted' : 'pending',
}))

type Mode = 'collapsed' | 'expanded' | 'done' | 'scroll' | 'interrupted' | 'play'

const script: TodoItem[][] = [
  tasks(0, 0),
  tasks(1, 1),
  tasks(2, 2),
  tasks(3, 3),
  tasks(4, 4),
  done,
]

const older: TodoItem[] = [
  { id: 'old-1', content: '确认这次要改的范围', status: 'completed' },
  { id: 'old-2', content: '记下当前内嵌轨道的位置', status: 'completed' },
]

function staticView(mode: Mode): { todos: TodoItem[]; phase: 'active' | 'complete' | 'interrupted'; expanded: boolean; scroll: boolean } {
  if (mode === 'expanded') return { todos: tasks(0, 0), phase: 'active', expanded: true, scroll: false }
  if (mode === 'done') return { todos: done, phase: 'complete', expanded: false, scroll: false }
  if (mode === 'scroll') return { todos: tasks(1, 1), phase: 'active', expanded: false, scroll: true }
  if (mode === 'interrupted') return { todos: interrupted, phase: 'interrupted', expanded: false, scroll: false }
  return { todos: tasks(0, 0), phase: 'active', expanded: false, scroll: false }
}

function TaskCardStage({ mode = 'collapsed' }: { mode?: Mode }) {
  const view = staticView(mode)
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(mode !== 'play')
  const [hovering, setHovering] = useState(false)
  const [memory, setMemory] = useState<TaskCardMemory>(EMPTY_TASK_CARD_MEMORY)

  useEffect(() => {
    const previous = i18n.language
    void i18n.changeLanguage('zh-Hans')
    return () => { void i18n.changeLanguage(previous) }
  }, [])

  useEffect(() => {
    setStep(0)
    setHovering(false)
    setVisible(mode !== 'play')
    setMemory(EMPTY_TASK_CARD_MEMORY)
  }, [mode])

  useEffect(() => {
    if (mode !== 'play') return
    const timers = [
      window.setTimeout(() => {
        const snapshot = snapshotFromTodos('play', script[0]!, false)
        setMemory(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
          type: 'list',
          snapshot,
          userTurnAfterList: false,
        }))
        setVisible(true)
      }, 400),
    ]
    for (let index = 1; index < script.length; index++) {
      timers.push(window.setTimeout(() => {
        setStep(index)
        setMemory(current => reduceTaskCardMemory(current, {
          type: 'list',
          snapshot: snapshotFromTodos('play', script[index]!, false),
          userTurnAfterList: false,
        }))
      }, 400 + index * 900))
    }
    return () => { timers.forEach(timer => window.clearTimeout(timer)) }
  }, [mode])

  useEffect(() => {
    if (mode !== 'play' || !shouldFadeTaskCard(memory, hovering)) return
    const timer = window.setTimeout(() => {
      setMemory(current => reduceTaskCardMemory(current, { type: 'fade' }))
      setVisible(false)
    }, TASK_CARD_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [hovering, memory, mode])

  const playing = mode === 'play'
  const todos = playing ? script[step]! : view.todos
  const phase = playing ? (memory.phase === 'hidden' ? 'complete' : memory.phase) : view.phase
  const expanded = playing ? memory.expanded : view.expanded
  const cardVisible = playing ? memory.phase !== 'hidden' : visible
  const showCard = playing ? memory.listKey !== null : true

  return (
    <div data-task-card-stage={mode} data-task-card-step={playing ? step : mode} className="flex h-full min-h-[560px] w-full flex-col bg-background text-foreground">
      <div className="relative min-h-0 flex-1">
        <div className="mx-auto flex h-full w-full max-w-[840px] flex-col justify-end px-5 pb-16">
          <div className="mb-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
            帮我看一下这台电脑，写一首秋天的小诗，再用一句话总结。
          </div>
          <div className="text-sm leading-6 text-foreground/80">
            <p>上一回合的任务收在一行里，点开可以回看完整轨道。</p>
            <TaskTurnSummary todos={older} />
            <p className="mt-3">这台 macOS 27.0.1 的工作目录有 6 个文件，磁盘还剩 699 GB。</p>
          </div>
        </div>
        {showCard && (
          <TaskProgressCard
            todos={todos}
            phase={phase}
            expanded={expanded}
            visible={cardVisible}
            onExpandedChange={(next) => {
              if (!playing) return
              setMemory(current => reduceTaskCardMemory(current, { type: 'expand', expanded: next }))
            }}
            onDismiss={() => {
              if (playing) {
                setMemory(current => reduceTaskCardMemory(current, {
                  type: 'dismiss',
                  snapshot: snapshotFromTodos('play', todos, false),
                }))
                return
              }
              setVisible(false)
            }}
            onHoverChange={setHovering}
            showScrollToBottom={!playing && view.scroll}
            onScrollToBottom={() => {}}
          />
        )}
      </div>
      <div className="mx-auto w-full max-w-[840px] px-5 pb-4">
        <div className="rounded-[16px] bg-background px-4 py-3 text-sm text-foreground/45 shadow-minimal">
          按 ⌘ + . 沉浸模式
        </div>
      </div>
    </div>
  )
}

export const taskCardComponents: ComponentEntry[] = [
  {
    id: 'task-card',
    name: 'Task Card',
    category: 'Turn Cards',
    description: 'Centered floating task capsule above the composer',
    component: TaskCardStage,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'mode',
        description: 'Collapsed capsule, expanded panel, completed, interrupted, with the back-to-bottom button, or the appear-to-fade script',
        control: {
          type: 'select',
          options: [
            { label: 'Collapsed', value: 'collapsed' },
            { label: 'Expanded', value: 'expanded' },
            { label: 'Completed', value: 'done' },
            { label: 'Interrupted', value: 'interrupted' },
            { label: 'With scroll button', value: 'scroll' },
            { label: 'Step through', value: 'play' },
          ],
        },
        defaultValue: 'collapsed',
      },
    ],
    variants: [
      { name: 'Collapsed', props: { mode: 'collapsed' } },
      { name: 'Expanded', props: { mode: 'expanded' } },
      { name: 'Completed', props: { mode: 'done' } },
      { name: 'Interrupted', props: { mode: 'interrupted' } },
      { name: 'With scroll button', props: { mode: 'scroll' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
