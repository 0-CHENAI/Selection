import { useEffect, useState } from 'react'
import { TaskRail, type TaskRailItem } from '@craft-agent/ui'
import { i18n } from '@craft-agent/shared/i18n'
import type { ComponentEntry } from './types'

const mixed: TaskRailItem[] = [
  { id: 'facts', content: '确认事实', status: 'completed' },
  { id: 'sources', content: '核对出处', status: 'interrupted' },
  { id: 'summary', content: '撰写摘要', status: 'in_progress', activeForm: '正在撰写摘要' },
  { id: 'appendix', content: '整理附录', status: 'pending' },
]

const script: TaskRailItem[][] = [
  [
    { id: 'facts', content: '确认事实', status: 'pending' },
    { id: 'sources', content: '核对出处', status: 'pending' },
    { id: 'summary', content: '撰写摘要', status: 'pending' },
    { id: 'appendix', content: '整理附录', status: 'pending' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'in_progress', activeForm: '正在确认事实' },
    { id: 'sources', content: '核对出处', status: 'pending' },
    { id: 'summary', content: '撰写摘要', status: 'pending' },
    { id: 'appendix', content: '整理附录', status: 'pending' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'completed' },
    { id: 'sources', content: '核对出处', status: 'in_progress', activeForm: '正在核对出处' },
    { id: 'summary', content: '撰写摘要', status: 'pending' },
    { id: 'appendix', content: '整理附录', status: 'pending' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'completed' },
    { id: 'sources', content: '核对出处', status: 'interrupted' },
    { id: 'summary', content: '撰写摘要', status: 'pending' },
    { id: 'appendix', content: '整理附录', status: 'pending' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'completed' },
    { id: 'sources', content: '核对出处', status: 'completed' },
    { id: 'summary', content: '撰写摘要', status: 'in_progress', activeForm: '正在撰写摘要' },
    { id: 'appendix', content: '整理附录', status: 'pending' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'completed' },
    { id: 'sources', content: '核对出处', status: 'completed' },
    { id: 'summary', content: '撰写摘要', status: 'completed' },
    { id: 'appendix', content: '整理附录', status: 'in_progress', activeForm: '正在整理附录' },
  ],
  [
    { id: 'facts', content: '确认事实', status: 'completed' },
    { id: 'sources', content: '核对出处', status: 'completed' },
    { id: 'summary', content: '撰写摘要', status: 'completed' },
    { id: 'appendix', content: '整理附录', status: 'completed' },
  ],
]

function TaskRailPreview({ mode = 'mixed' }: { mode?: 'mixed' | 'play' }) {
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

  const items = mode === 'play' ? script[step]! : mixed

  return (
    <div data-task-rail-preview="" data-task-rail-step={mode === 'play' ? step : 'mixed'} className="w-[440px] bg-background px-6 py-8 text-foreground">
      <TaskRail items={items} />
    </div>
  )
}

export const taskRailComponents: ComponentEntry[] = [
  {
    id: 'task-rail',
    name: 'Task Rail',
    category: 'Turn Cards',
    description: 'Read-only rail for conversation task progress',
    component: TaskRailPreview,
    layout: 'centered',
    previewOverflow: 'visible',
    props: [
      {
        name: 'mode',
        description: 'Static mixed statuses, or a looping progress script',
        control: {
          type: 'select',
          options: [
            { label: 'Mixed states', value: 'mixed' },
            { label: 'Step through', value: 'play' },
          ],
        },
        defaultValue: 'mixed',
      },
    ],
    variants: [
      { name: 'Mixed states', props: { mode: 'mixed' } },
      { name: 'Step through', props: { mode: 'play' } },
    ],
  },
]
