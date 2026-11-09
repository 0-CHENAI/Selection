import { useEffect, useState } from 'react'
import { TaskProgressCard, TaskTurnSummary, type TodoItem } from '@craft-agent/ui'
import { i18n } from '@craft-agent/shared/i18n'
import type { ComponentEntry } from './types'

const labels = ['查看 macOS 版本', '统计工作目录文件', '查看磁盘剩余空间', '写一首秋天的小诗', '计算 1 到 100 的质数和', '用一句话总结以上结果'] as const
const LIST_SEED = 'playground-task-card'

function tasks(active: number, doneThrough = active): TodoItem[] {
  return labels.map((label, index) => ({
    id: label,
    content: label,
    status: index < doneThrough ? 'completed' : index === active ? 'in_progress' : 'pending',
    activeForm: index === active ? `正在${label}` : undefined,
  }))
}

const done = labels.map(label => ({ id: label, content: label, status: 'completed' as const }))

function stoppedAt(active: number): TodoItem[] {
  return labels.map((label, index) => ({
    id: label,
    content: label,
    status: index < active ? 'completed' : index === active ? 'interrupted' : 'pending',
  }))
}

const interrupted = stoppedAt(2)

type Mode = 'collapsed' | 'expanded' | 'done' | 'scroll' | 'interrupted' | 'summary' | 'play'
type Phase = 'active' | 'complete' | 'interrupted'
type Story = 'idle' | 'playing' | 'holding' | 'sent' | 'summary'

const script: Array<{ at: number; todos: TodoItem[]; phase: Phase }> = [
  { at: 0, todos: tasks(0, 0), phase: 'active' },
  { at: 900, todos: tasks(1, 1), phase: 'active' },
  { at: 1800, todos: tasks(2, 2), phase: 'active' },
  { at: 2700, todos: tasks(3, 3), phase: 'active' },
  { at: 3600, todos: tasks(4, 4), phase: 'active' },
  { at: 4500, todos: done, phase: 'complete' },
]

function staticView(mode: Mode): { todos: TodoItem[]; phase: Phase; expanded: boolean; scroll: boolean } {
  if (mode === 'expanded') return { todos: tasks(3, 3), phase: 'active', expanded: true, scroll: false }
  if (mode === 'done') return { todos: done, phase: 'complete', expanded: false, scroll: false }
  if (mode === 'scroll') return { todos: tasks(3, 3), phase: 'active', expanded: false, scroll: true }
  if (mode === 'interrupted') return { todos: interrupted, phase: 'interrupted', expanded: false, scroll: false }
  return { todos: tasks(0, 0), phase: 'active', expanded: false, scroll: false }
}

function TaskCardStage({ mode = 'collapsed' }: { mode?: Mode }) {
  const view = staticView(mode)
  const [expanded, setExpanded] = useState(view.expanded)
  const [visible, setVisible] = useState(mode !== 'play' && mode !== 'summary')
  const [todos, setTodos] = useState<TodoItem[]>(view.todos)
  const [phase, setPhase] = useState<Phase>(view.phase)
  const [secondAsk, setSecondAsk] = useState(false)
  const [showSummary, setShowSummary] = useState(mode === 'summary')
  const [story, setStory] = useState<Story>(mode === 'play' ? 'playing' : 'idle')

  useEffect(() => {
    const previous = i18n.language
    void i18n.changeLanguage('zh-Hans')
    return () => { void i18n.changeLanguage(previous) }
  }, [])

  useEffect(() => {
    const next = staticView(mode)
    setExpanded(next.expanded)
    setTodos(next.todos)
    setPhase(next.phase)
    setVisible(mode !== 'play' && mode !== 'summary')
    setSecondAsk(false)
    setShowSummary(mode === 'summary')
    setStory(mode === 'play' ? 'playing' : 'idle')
  }, [mode])

  useEffect(() => {
    if (mode !== 'play') return
    const doneAt = script[script.length - 1]!.at
    const timers = script.map(step => window.setTimeout(() => {
      setTodos(step.todos)
      setPhase(step.phase)
      setVisible(true)
      setExpanded(false)
      setStory(step.phase === 'complete' ? 'holding' : 'playing')
    }, step.at))
    timers.push(window.setTimeout(() => {
      setSecondAsk(true)
      setVisible(false)
      setStory('sent')
    }, doneAt + 4000))
    timers.push(window.setTimeout(() => {
      setShowSummary(true)
      setStory('summary')
    }, doneAt + 4600))
    return () => { timers.forEach(timer => window.clearTimeout(timer)) }
  }, [mode])

  const cardVisible = mode === 'play' ? visible : true
  const completionLine = mode === 'done' || mode === 'summary' || (mode === 'play' && story !== 'playing' && story !== 'idle')

  return (
    <div
      data-task-card-stage={mode}
      data-task-card-story={mode === 'play' ? story : undefined}
      className="flex h-full min-h-[560px] w-full flex-col bg-background text-foreground"
    >
      <div className="relative min-h-0 flex-1">
        <div className="mx-auto flex h-full w-full max-w-[840px] flex-col justify-end px-5 pb-16">
          <div className="mb-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
            帮我看一下这台电脑，写一首秋天的小诗，再用一句话总结。
          </div>
          <div className="text-sm leading-6 text-foreground/80">
            <p>这台 macOS 27.0.1 的工作目录有 6 个文件，磁盘还剩 699 GB。</p>
            {completionLine && <p className="mt-3">六项任务全部完成。</p>}
            {showSummary && <TaskTurnSummary todos={done} listSeed={LIST_SEED} settled />}
          </div>
          {secondAsk && (
            <div className="mt-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
              再帮我看一下磁盘剩余空间。
            </div>
          )}
          {mode === 'summary' && (
            <div className="mt-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
              再帮我看一下磁盘剩余空间。
            </div>
          )}
        </div>
        {mode === 'scroll' && (
          <div className="absolute inset-x-0 bottom-16 h-[30px]">
            <div className="relative mx-auto h-full max-w-[840px]">
              <TaskProgressCard
                todos={todos}
                listSeed={LIST_SEED}
                phase={phase}
                expanded={expanded}
                visible={cardVisible}
                placement="toolbar"
                onExpandedChange={setExpanded}
                showScrollToBottom
                onScrollToBottom={() => {}}
              />
            </div>
          </div>
        )}
        {mode !== 'summary' && mode !== 'scroll' && (
          <TaskProgressCard
            todos={todos}
            listSeed={LIST_SEED}
            phase={phase}
            expanded={expanded}
            visible={cardVisible}
            onExpandedChange={setExpanded}
            showScrollToBottom={mode !== 'play' && view.scroll}
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
    description: 'Collapsed capsule shows only the step count; open it for the task list',
    component: TaskCardStage,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'mode',
        description: 'Collapsed capsule shows only X/X. Expanded panel keeps the progress heading and rail. With scroll button, the control grows out of the pill on the toolbar row. Also completed, interrupted, history summary, or the hold-then-dismiss story',
        control: {
          type: 'select',
          options: [
            { label: 'Collapsed', value: 'collapsed' },
            { label: 'Expanded', value: 'expanded' },
            { label: 'Completed', value: 'done' },
            { label: 'Interrupted', value: 'interrupted' },
            { label: 'After next message', value: 'summary' },
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
      { name: 'After next message', props: { mode: 'summary' } },
      { name: 'With scroll button', props: { mode: 'scroll' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
