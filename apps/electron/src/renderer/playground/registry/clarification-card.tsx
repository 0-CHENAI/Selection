import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import type { Message } from '@craft-agent/core/types'
import {
  ClarificationCard,
  ClarificationFoldDetails,
  TurnCard,
  TooltipProvider,
} from '@craft-agent/ui'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { ComponentEntry } from './types'

const previewI18n = createInstance()
void previewI18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } },
})

const questions = [
  {
    id: 'audience',
    question: '这份报告主要给谁看？',
    selection: 'single' as const,
    options: [
      { id: 'exec', label: '管理层，用于决策评审' },
      { id: 'team', label: '业务团队，用于落地执行' },
      { id: 'client', label: '外部客户，用于正式汇报' },
    ],
  },
  {
    id: 'years',
    question: '这次需要覆盖哪些年份？',
    selection: 'multi' as const,
    options: [
      { id: '2024', label: '2024' },
      { id: '2025', label: '2025' },
      { id: '2026', label: '2026' },
    ],
  },
  {
    id: 'form',
    question: '交付形式更倾向哪种？',
    selection: 'single' as const,
    options: [
      { id: 'slides', label: '幻灯片汇报' },
      { id: 'doc', label: '书面报告' },
      { id: 'both', label: '两者都要' },
    ],
  },
]

function pending(frame: number, extras: Partial<NonNullable<Message['clarification']>> = {}): Message {
  return {
    id: `preview-${frame}`,
    role: 'clarification',
    content: questions[0]!.question,
    timestamp: 1,
    clarification: {
      requestId: 'preview',
      question: questions[0]!.question,
      questions,
      ambiguity: 'scope',
      selection: 'single',
      options: questions[0]!.options,
      round: 3,
      status: 'pending',
      originSessionId: 'preview',
      ...extras,
    },
  }
}

const settled: Message = {
  id: 'preview-settled',
  role: 'clarification',
  content: questions[0]!.question,
  timestamp: 3,
  clarification: {
    requestId: 'preview',
    question: questions[0]!.question,
    questions: [
      { ...questions[0]!, status: 'answered', selectedOptionIds: ['team'] },
      { ...questions[1]!, status: 'skipped' },
      { ...questions[2]!, status: 'answered', selectedOptionIds: ['doc'] },
    ],
    ambiguity: 'scope',
    selection: 'single',
    options: questions[0]!.options,
    round: 3,
    status: 'answered',
    selectedOptionIds: ['team'],
    originSessionId: 'preview',
  },
}

function Frame({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="max-w-[420px]">{children}</div>
    </div>
  )
}

function ClarificationPreview({ variant }: { variant: string }) {
  return (
    <I18nextProvider i18n={previewI18n}>
      <TooltipProvider>
        <div className="flex flex-col gap-8 bg-background p-8">
          {(variant === 'all' || variant === 'q1') && (
            <Frame label="第 1 题 · 单选，已选一项">
              <ClarificationCard
                message={pending(0, {
                  questions: [
                    { ...questions[0]!, selectedOptionIds: ['team'] },
                    questions[1]!,
                    questions[2]!,
                  ],
                })}
                interactive
                initialStep={0}
              />
            </Frame>
          )}
          {(variant === 'all' || variant === 'q2') && (
            <Frame label="第 2 题 · 多选并填写补充说明">
              <ClarificationCard
                message={pending(1, {
                  questions: [
                    { ...questions[0]!, selectedOptionIds: ['team'] },
                    { ...questions[1]!, selectedOptionIds: ['2025', '2026'], text: '以 2025 为主，2026 只写展望' },
                    questions[2]!,
                  ],
                })}
                interactive
                initialStep={1}
              />
            </Frame>
          )}
          {(variant === 'all' || variant === 'q3') && (
            <Frame label="第 3 题（最后一题）· 第 2 题已跳过 · 提交保持可用">
              <ClarificationCard
                message={pending(2, {
                  questions: [
                    { ...questions[0]!, selectedOptionIds: ['team'] },
                    questions[1]!,
                    { ...questions[2]!, selectedOptionIds: ['doc'] },
                  ],
                })}
                interactive
                initialStep={2}
              />
            </Frame>
          )}
          {(variant === 'all' || variant === 'answered') && (
            <Frame label="提交后的 answered 状态">
              <ClarificationCard message={settled} />
            </Frame>
          )}
          {(variant === 'all' || variant === 'fold') && (
            <Frame label="过程折叠：整批一行摘要">
              <TurnCard
                turnId="preview-fold"
                intent="Check attachments"
                activities={[
                  { id: 'read', type: 'tool', toolName: 'Read', status: 'completed', intent: 'Read the brief', timestamp: 1 },
                  { id: 'clarify', type: 'tool', toolName: 'clarify', status: 'completed', content: 'Waiting for clarification', timestamp: 2 },
                  { id: 'bash', type: 'tool', toolName: 'Bash', status: 'completed', intent: 'Check attachments', timestamp: 4 },
                ]}
                clarifications={[settled]}
                isStreaming={false}
                isComplete
                isExpanded
                renderActionsMenu={() => null}
              />
            </Frame>
          )}
          {(variant === 'all' || variant === 'details') && (
            <Frame label="打开后的合并详情">
              <div className="rounded-2xl border border-border bg-card p-4">
                <ClarificationFoldDetails messages={[settled]} />
              </div>
            </Frame>
          )}
        </div>
      </TooltipProvider>
    </I18nextProvider>
  )
}

export const clarificationCardComponents: ComponentEntry[] = [
  {
    id: 'clarification-question-card',
    name: 'Clarification Question Card',
    category: 'Chat Messages',
    description: 'Motif-aligned multi-question clarification card',
    component: ClarificationPreview,
    layout: 'top',
    props: [
      {
        name: 'variant',
        description: 'Which approved frame to show',
        control: {
          type: 'select',
          options: [
            { label: 'All frames', value: 'all' },
            { label: 'Q1 single', value: 'q1' },
            { label: 'Q2 multi', value: 'q2' },
            { label: 'Q3 last / skip', value: 'q3' },
            { label: 'Answered', value: 'answered' },
            { label: 'Process fold', value: 'fold' },
            { label: 'Combined details', value: 'details' },
          ],
        },
        defaultValue: 'all',
      },
    ],
    variants: [
      { name: 'q1', props: { variant: 'q1' } },
      { name: 'q2', props: { variant: 'q2' } },
      { name: 'q3', props: { variant: 'q3' } },
      { name: 'answered', props: { variant: 'answered' } },
      { name: 'fold', props: { variant: 'fold' } },
      { name: 'details', props: { variant: 'details' } },
      { name: 'all', props: { variant: 'all' } },
    ],
  },
]
