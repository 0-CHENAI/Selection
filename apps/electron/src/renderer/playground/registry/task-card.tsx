import { useEffect, useState } from 'react'
import { TaskProgressCard, TaskTurnSummary, type TodoItem } from '@craft-agent/ui'
import { TASK_CARD_HOLD_MS } from '@craft-agent/ui/chat'
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

const script: Array<{ at: number; todos: TodoItem[]; phase: Phase }> = [
  { at: 400, todos: tasks(0, 0), phase: 'active' },
  { at: 1100, todos: tasks(1, 1), phase: 'active' },
  { at: 1800, todos: tasks(2, 2), phase: 'active' },
  { at: 2500, todos: tasks(3, 3), phase: 'active' },
  { at: 3200, todos: tasks(4, 4), phase: 'active' },
  { at: 3900, todos: done, phase: 'complete' },
]

function staticView(mode: Mode): { todos: TodoItem[]; phase: Phase; expanded: boolean; scroll: boolean } {
  if (mode === 'expanded') return { todos: tasks(0, 0), phase: 'active', expanded: true, scroll: false }
  if (mode === 'done') return { todos: done, phase: 'complete', expanded: false, scroll: false }
  if (mode === 'scroll') return { todos: tasks(1, 1), phase: 'active', expanded: false, scroll: true }
  if (mode === 'interrupted') return { todos: interrupted, phase: 'interrupted', expanded: false, scroll: false }
  return { todos: tasks(0, 0), phase: 'active', expanded: false, scroll: false }
}

function TaskCardStage({ mode = 'collapsed' }: { mode?: Mode }) {
  const view = staticView(mode)
  const [expanded, setExpanded] = useState(view.expanded)
  const [visible, setVisible] = useState(mode !== 'play' && mode !== 'summary')
  const [todos, setTodos] = useState<TodoItem[]>(view.todos)
  const [phase, setPhase] = useState<Phase>(view.phase)
  const [rounds, setRounds] = useState<TodoItem[][]>([])
  const [secondAsk, setSecondAsk] = useState(false)
  const [story, setStory] = useState<'idle' | 'playing' | 'done'>(mode === 'play' ? 'playing' : 'idle')

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
    setRounds(mode === 'summary' ? [done] : [])
    setSecondAsk(false)
    setStory(mode === 'play' ? 'playing' : 'idle')
  }, [mode])

  useEffect(() => {
    if (mode !== 'play') return
    const hold = TASK_CARD_HOLD_MS
    const show = (next: TodoItem[], nextPhase: Phase) => {
      setTodos(next)
      setPhase(nextPhase)
      setVisible(true)
    }
    const settle = (next: TodoItem[]) => {
      setRounds(current => [...current, next])
      setVisible(false)
    }
    const second = script[script.length - 1]!.at + hold
    const stopStart = second + 1200
    const stopMark = stopStart + 2100
    const timers = script.map(step => window.setTimeout(() => show(step.todos, step.phase), step.at))
    timers.push(window.setTimeout(() => settle(done), second))
    timers.push(window.setTimeout(() => setSecondAsk(true), second + 700))
    timers.push(window.setTimeout(() => show(tasks(0, 0), 'active'), stopStart))
    timers.push(window.setTimeout(() => show(tasks(1, 1), 'active'), stopStart + 700))
    timers.push(window.setTimeout(() => show(tasks(2, 2), 'active'), stopStart + 1400))
    timers.push(window.setTimeout(() => show(interrupted, 'interrupted'), stopMark))
    timers.push(window.setTimeout(() => settle(interrupted), stopMark + hold))
    timers.push(window.setTimeout(() => setStory('done'), stopMark + hold + 1600))
    return () => { timers.forEach(timer => window.clearTimeout(timer)) }
  }, [mode])

  const showCard = mode !== 'summary' && (mode !== 'play' || story !== 'idle')
  const cardVisible = mode === 'play' ? visible : mode !== 'summary'

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
            {mode !== 'play' && (
              <>
                <p>上一回合的任务收在一行里，点开可以回看完整轨道。</p>
                <TaskTurnSummary
                  todos={[
                    { id: 'old-1', content: '确认这次要改的范围', status: 'completed' },
                    { id: 'old-2', content: '记下当前内嵌轨道的位置', status: 'completed' },
                  ]}
                  settled
                />
              </>
            )}
            <p className={mode === 'play' ? '' : 'mt-3'}>这台 macOS 27.0.1 的工作目录有 6 个文件，磁盘还剩 699 GB。</p>
            {rounds.map((round, index) => (
              <TaskTurnSummary key={`${round[0]?.id ?? 'round'}-${index}`} todos={round} settled />
            ))}
          </div>
          {secondAsk && (
            <div className="mt-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
              先停在检查磁盘这里。
            </div>
          )}
        </div>
        {showCard && (
          <TaskProgressCard
            todos={todos}
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
    description: 'Centered floating task capsule that folds itself back into the turn',
    component: TaskCardStage,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'mode',
        description: 'Collapsed capsule, expanded panel, completed, interrupted, inline summary, with the back-to-bottom button, or the auto-dismiss story',
        control: {
          type: 'select',
          options: [
            { label: 'Collapsed', value: 'collapsed' },
            { label: 'Expanded', value: 'expanded' },
            { label: 'Completed', value: 'done' },
            { label: 'Interrupted', value: 'interrupted' },
            { label: 'Inline summary', value: 'summary' },
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
      { name: 'Inline summary', props: { mode: 'summary' } },
      { name: 'With scroll button', props: { mode: 'scroll' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
