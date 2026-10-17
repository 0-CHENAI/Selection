import { useEffect, useState } from 'react'
import { TodoList, type TodoItem } from '@craft-agent/ui'
import { i18n } from '@craft-agent/shared/i18n'
import type { ComponentEntry } from './types'

const labels = ['确认事实', '核对出处', '撰写摘要', '确认范围', '整理附录', '对照文献', '标注出处'] as const

function tasks(patch: Partial<Record<(typeof labels)[number], Partial<TodoItem>>> = {}): TodoItem[] {
  return labels.map(label => ({
    id: label,
    content: label,
    status: 'pending' as const,
    ...patch[label],
  }))
}

const progress = tasks({
  确认事实: { status: 'completed' },
  核对出处: { status: 'completed' },
  撰写摘要: { status: 'completed' },
  确认范围: { status: 'in_progress', activeForm: '正在确认范围' },
})

const done = tasks({
  确认事实: { status: 'completed' },
  核对出处: { status: 'completed' },
  撰写摘要: { status: 'completed' },
  确认范围: { status: 'completed' },
  整理附录: { status: 'completed' },
  对照文献: { status: 'completed' },
  标注出处: { status: 'completed' },
})

const interrupted = tasks({
  确认事实: { status: 'completed' },
  核对出处: { status: 'completed' },
  撰写摘要: { status: 'interrupted' },
  确认范围: { status: 'in_progress', activeForm: '正在确认范围' },
})

const script: TodoItem[][] = [
  tasks(),
  tasks({ 确认事实: { status: 'in_progress', activeForm: '正在确认事实' } }),
  tasks({
    确认事实: { status: 'completed' },
    核对出处: { status: 'in_progress', activeForm: '正在核对出处' },
  }),
  tasks({
    确认事实: { status: 'completed' },
    核对出处: { status: 'interrupted' },
  }),
  progress,
  tasks({
    确认事实: { status: 'completed' },
    核对出处: { status: 'completed' },
    撰写摘要: { status: 'completed' },
    确认范围: { status: 'completed' },
    整理附录: { status: 'in_progress', activeForm: '正在整理附录' },
  }),
  done,
]

const catalogs = { progress, done, interrupted } as const

function TaskListPreview({ mode = 'progress' }: { mode?: 'progress' | 'done' | 'interrupted' | 'play' }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const previous = i18n.language
    void i18n.changeLanguage('zh-Hans')
    return () => { void i18n.changeLanguage(previous) }
  }, [])

  useEffect(() => {
    if (mode !== 'play') return
    const timer = window.setInterval(() => {
      setStep(current => (current + 1) % script.length)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [mode])

  const items = mode === 'play' ? script[step]! : catalogs[mode]

  return (
    <div data-task-rail-preview="" data-task-rail-step={mode === 'play' ? step : mode} className="w-[440px] bg-background px-6 py-8 text-foreground">
      <TodoList todos={items} />
    </div>
  )
}

export const taskRailComponents: ComponentEntry[] = [
  {
    id: 'task-rail',
    name: 'Task Rail',
    category: 'Turn Cards',
    description: 'Read-only rare-ui rail for conversation task progress',
    component: TaskListPreview,
    layout: 'centered',
    previewOverflow: 'visible',
    props: [
      {
        name: 'mode',
        description: 'In progress, all completed, interrupted, or a looping script',
        control: {
          type: 'select',
          options: [
            { label: 'In progress', value: 'progress' },
            { label: 'All completed', value: 'done' },
            { label: 'Interrupted', value: 'interrupted' },
            { label: 'Step through', value: 'play' },
          ],
        },
        defaultValue: 'progress',
      },
    ],
    variants: [
      { name: 'In progress', props: { mode: 'progress' } },
      { name: 'All completed', props: { mode: 'done' } },
      { name: 'Interrupted', props: { mode: 'interrupted' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
