import { useEffect, useState } from 'react'
import { TaskProgressCard, TaskTurnSummary, type TodoItem } from '@craft-agent/ui'
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

const catalogs = {
  expanded: tasks(2),
  collapsed: tasks(2),
  done: labels.map(label => ({ id: label, content: label, status: 'completed' as const })),
  scroll: tasks(3),
  play: tasks(0, 0),
}

const script: TodoItem[][] = [
  tasks(0, 0),
  tasks(1, 1),
  tasks(2, 2),
  tasks(3, 3),
  tasks(4, 4),
  catalogs.done,
]

const older: TodoItem[] = [
  { id: 'old-1', content: '确认这次要改的范围', status: 'completed' },
  { id: 'old-2', content: '记下当前内嵌轨道的位置', status: 'completed' },
]

function TaskCardStage({ mode = 'expanded' }: { mode?: 'expanded' | 'collapsed' | 'done' | 'scroll' | 'play' }) {
  const [step, setStep] = useState(0)
  const [expanded, setExpanded] = useState(mode === 'expanded' || mode === 'scroll' || mode === 'play')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const previous = i18n.language
    void i18n.changeLanguage('zh-Hans')
    return () => { void i18n.changeLanguage(previous) }
  }, [])

  useEffect(() => {
    setExpanded(mode === 'expanded' || mode === 'scroll' || mode === 'play')
    setHidden(false)
    setStep(0)
  }, [mode])

  useEffect(() => {
    if (mode !== 'play') return
    const timer = window.setInterval(() => {
      setStep(current => (current + 1) % script.length)
    }, 900)
    return () => window.clearInterval(timer)
  }, [mode])

  const todos = mode === 'play' ? script[step]! : catalogs[mode]
  const showScroll = mode === 'scroll' || mode === 'play'

  return (
    <div data-task-card-stage={mode} data-task-card-step={mode === 'play' ? step : mode} className="flex h-full min-h-[560px] w-full flex-col bg-background text-foreground">
      <div className="relative min-h-0 flex-1">
        <div className="mx-auto flex h-full w-full max-w-[840px] flex-col justify-end px-5 pb-4">
          <div className="mb-4 max-w-[75%] self-end rounded-[12px] bg-foreground/[0.05] px-4 py-2.5 text-sm">
            帮我看一下这台电脑，写一首秋天的小诗，再用一句话总结。
          </div>
          <div className="text-sm leading-6 text-foreground/80">
            <p>上一回合的任务收在一行里，点开可以回看完整轨道。</p>
            <TaskTurnSummary todos={older} />
            <p className="mt-3">这台 macOS 27.0.1 的工作目录有 6 个文件，磁盘还剩 699 GB。</p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[840px] px-5 pb-4">
        {!hidden && (
          <TaskProgressCard
            todos={todos}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onDismiss={() => setHidden(true)}
            showScrollToBottom={showScroll}
            onScrollToBottom={() => {}}
          />
        )}
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
    description: 'Collapsible task progress pinned above the composer',
    component: TaskCardStage,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'mode',
        description: 'Expanded, collapsed, completed, with the back-to-bottom button, or a stepping script',
        control: {
          type: 'select',
          options: [
            { label: 'Expanded', value: 'expanded' },
            { label: 'Collapsed', value: 'collapsed' },
            { label: 'Completed', value: 'done' },
            { label: 'With scroll button', value: 'scroll' },
            { label: 'Step through', value: 'play' },
          ],
        },
        defaultValue: 'expanded',
      },
    ],
    variants: [
      { name: 'Expanded', props: { mode: 'expanded' } },
      { name: 'Collapsed', props: { mode: 'collapsed' } },
      { name: 'Completed', props: { mode: 'done' } },
      { name: 'With scroll button', props: { mode: 'scroll' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
