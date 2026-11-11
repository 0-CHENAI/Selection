import * as React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, MessageCircleQuestionMark, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { ClarificationQuestionState, Message } from '@craft-agent/core/types'
import {
  canSubmitClarification,
  clarificationQuestions,
  toggleClarificationSelection,
} from '@craft-agent/shared/agent/clarification'
import { cn } from '../../lib/utils'
import { ContentFrame } from '../overlay/ContentFrame'
import { PreviewOverlay } from '../overlay/PreviewOverlay'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const SPRING_SWAP = { damping: 30, mass: 0.55, stiffness: 460 } as const
const BAR_REST_WIDTH = 8
const BAR_CURRENT_WIDTH = 16
const BAR_HOVER_WIDTH = 20

type LocalAnswer = { selected: string[]; custom: string }

const EMPTY_ANSWER: LocalAnswer = { selected: [], custom: '' }

export interface ClarificationQuestionAnswer {
  questionId: string
  skipped: boolean
  optionIds: string[]
  text: string
}

export interface ClarificationResponse {
  skipped: boolean
  optionIds: string[]
  text: string
  answers: ClarificationQuestionAnswer[]
}

export interface ClarificationCardProps {
  message: Message
  interactive?: boolean
  onRespond?: (response: ClarificationResponse) => void
  /** Playground and tests: start on a later step. */
  initialStep?: number
}

export interface ClarificationSummaryProps {
  messages: readonly Message[]
}

function isAnswered(answer: LocalAnswer): boolean {
  return canSubmitClarification({ skipped: false, optionIds: answer.selected, text: answer.custom })
}

function answersFromState(data: NonNullable<Message['clarification']>): Record<string, LocalAnswer> {
  const next: Record<string, LocalAnswer> = {}
  for (const question of clarificationQuestions(data)) {
    next[question.id] = {
      selected: question.selectedOptionIds ?? [],
      custom: question.text ?? '',
    }
  }
  return next
}

function questionStatus(
  question: ClarificationQuestionState,
  batchStatus: NonNullable<Message['clarification']>['status'],
): 'answered' | 'skipped' | 'pending' {
  if (question.status === 'answered' || question.status === 'skipped' || question.status === 'pending') return question.status
  if (batchStatus === 'answered' || batchStatus === 'skipped') return batchStatus
  return 'pending'
}

export function clarificationOutcomeCounts(messages: readonly Message[]): { answered: number; skipped: number } {
  let answered = 0
  let skipped = 0
  for (const message of messages) {
    const data = message.clarification
    if (!data) continue
    for (const question of clarificationQuestions(data)) {
      const status = questionStatus(question, data.status)
      if (status === 'answered') answered += 1
      else if (status === 'skipped') skipped += 1
    }
  }
  return { answered, skipped }
}

/** Every settled title includes the question count, including a single question. */
export function clarificationSummaryLabel(
  counts: { answered: number; skipped: number },
  t: TFunction,
): string {
  const { answered, skipped } = counts
  if (answered > 0 && skipped > 0) return t('chat.clarificationSummaryMixed', { answered, skipped })
  if (skipped > 1) return t('chat.clarificationSkippedCount_other', { count: skipped })
  if (skipped === 1) return t('chat.clarificationSkippedCount_one', { count: skipped })
  if (answered > 1) return t('chat.clarificationAnswered_other', { count: answered })
  return t('chat.clarificationAnswered_one', { count: answered })
}

export function clarificationSummaryStatus(
  counts: { answered: number; skipped: number },
): 'answered' | 'skipped' | 'mixed' {
  if (counts.answered > 0 && counts.skipped > 0) return 'mixed'
  if (counts.skipped > 0) return 'skipped'
  return 'answered'
}

/** Keep a settled status readable in a process-fold title, without burying a real step label. */
export function clarificationBriefTitle(
  preview: string,
  statusLabel: string | undefined,
  genericLabels: readonly string[] = [],
): string {
  if (!statusLabel) return preview
  const trimmed = preview.trim()
  if (!trimmed || genericLabels.includes(trimmed)) return statusLabel
  if (trimmed === statusLabel || trimmed.startsWith(`${statusLabel} · `)) return trimmed
  return `${statusLabel} · ${trimmed}`
}

function settledClarificationMessages(messages: readonly Message[]): Message[] {
  return messages.filter(message => {
    const status = message.clarification?.status
    return status === 'answered' || status === 'skipped'
  })
}

/** Status line for one settled clarification. The fold header keeps the multi-count copy. */
export function clarificationRowLabel(message: Message, t: TFunction): string {
  return clarificationSummaryLabel(clarificationOutcomeCounts([message]), t)
}

function buildResponse(
  questions: readonly ClarificationQuestionState[],
  answers: Record<string, LocalAnswer>,
): ClarificationResponse {
  const items = questions.map(question => {
    const answer = answers[question.id] ?? EMPTY_ANSWER
    const skipped = !isAnswered(answer)
    return {
      questionId: question.id,
      skipped,
      optionIds: skipped ? [] : answer.selected,
      text: skipped ? '' : answer.custom.trim(),
    }
  })
  const first = items[0]
  return {
    skipped: items.every(item => item.skipped),
    optionIds: first && !first.skipped ? first.optionIds : [],
    text: first && !first.skipped ? first.text : '',
    answers: items,
  }
}

/**
 * Question, options, and the answer or skip note. Shown in the step detail
 * popup, not as a block inside the process list.
 */
export function ClarificationFoldDetails({
  messages,
  showStatus,
}: {
  messages: readonly Message[]
  /** When entries are split along the timeline, still mark each one in a mixed group. */
  showStatus?: boolean
}) {
  const settled = settledClarificationMessages(messages)
  if (settled.length === 0) return null
  const questionCount = settled.reduce((sum, message) => (
    message.clarification ? sum + clarificationQuestions(message.clarification).length : sum
  ), 0)
  const markStatus = showStatus ?? questionCount > 1
  return (
    <div data-clarification-fold="" className="flex flex-col">
      {settled.map((message, index) => (
        <ClarificationDetail
          key={message.id}
          message={message}
          showStatus={markStatus}
          leadingDivider={index > 0}
        />
      ))}
    </div>
  )
}

/** Settled clarification body, used by the detail popup. */
export function ClarificationSummary({ messages }: ClarificationSummaryProps) {
  return <ClarificationFoldDetails messages={messages} />
}

/**
 * One completed clarification in the process list: icon and status title.
 * The question, options, and answer open in the same preview overlay as other steps.
 */
export function ClarificationChainRow({ message }: { message: Message }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const status = message.clarification?.status
  if (status !== 'answered' && status !== 'skipped') return null
  const counts = clarificationOutcomeCounts([message])
  const label = clarificationSummaryLabel(counts, t)
  return (
    <>
      <button
        type="button"
        data-clarification-row=""
        data-clarification-status={clarificationSummaryStatus(counts)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'group/row flex w-full min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[13px] text-muted-foreground',
          'rounded-[6px] hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <span data-clarification-icon="" className="flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
          <MessageCircleQuestionMark className="h-3 w-3 shrink-0" />
        </span>
        <span className="min-w-0 flex-1 truncate group-hover/row:underline">{label}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100" aria-hidden="true" />
      </button>
      {open && (
        <ClarificationDetailsOverlay message={message} isOpen onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/** Detail popup for one settled clarification batch. Matches the other step preview overlays. */
export function ClarificationDetailsOverlay({
  message,
  isOpen,
  onClose,
  embedded = false,
}: {
  message: Message
  isOpen: boolean
  onClose: () => void
  /** Render inline for tests and the playground, without a dialog portal. */
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const label = clarificationRowLabel(message, t)
  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      embedded={embedded}
      typeBadge={{ icon: MessageCircleQuestionMark, label, variant: 'blue' }}
      title={label}
    >
      <div data-clarification-popup="">
        <ContentFrame title={label}>
          <div className="px-8 py-6">
            <ClarificationFoldDetails messages={[message]} />
          </div>
        </ContentFrame>
      </div>
    </PreviewOverlay>
  )
}

function QuestionDetail({
  question,
  batchStatus,
  showStatus,
  divider,
}: {
  question: ClarificationQuestionState
  batchStatus: NonNullable<Message['clarification']>['status']
  showStatus: boolean
  divider: boolean
}) {
  const { t, i18n } = useTranslation()
  const status = questionStatus(question, batchStatus)
  if (status !== 'answered' && status !== 'skipped') return null
  const selected = new Set(question.selectedOptionIds ?? [])
  const labels = question.options.filter(option => selected.has(option.id)).map(option => option.label)
  const skipped = status === 'skipped'
  const answerText = question.text?.trim()
  const joined = labels.join(i18n.language?.startsWith('zh') ? '、' : ', ')
  return (
    <div
      data-clarification-detail=""
      data-clarification-question={question.id}
      data-clarification-status={status}
      className={cn(divider && 'mt-4 border-t border-border pt-4')}
    >
      {showStatus && (
        <p className="text-xs text-muted-foreground">
          {skipped ? t('chat.clarificationSkippedShort') : t('chat.clarificationAnsweredShort')}
        </p>
      )}
      <h3 className={cn('text-sm font-medium text-foreground', showStatus && 'mt-1')}>{question.question}</h3>
      {question.options.length > 0 && (
        <ul data-clarification-options="" className="mt-3 flex flex-col gap-2">
          {question.options.map(option => {
            const chosen = selected.has(option.id)
            return (
              <li
                key={option.id}
                data-clarification-option={option.id}
                data-selected={chosen ? 'true' : 'false'}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  chosen ? 'border-foreground bg-foreground/5 font-medium text-foreground' : 'border-border text-muted-foreground',
                )}
              >
                {option.label}
              </li>
            )
          })}
        </ul>
      )}
      {skipped ? (
        <p data-clarification-skipped="" className="mt-3 text-sm text-foreground">
          {t('chat.clarificationSkipped')}
        </p>
      ) : (labels.length > 0 || answerText) && (
        <div data-clarification-answer="" className="mt-3 text-sm text-foreground">
          <p className="text-xs text-muted-foreground">{t('chat.clarificationYourAnswer')}</p>
          {labels.length > 0 && <p className="mt-1">{joined}</p>}
          {answerText && <p className="mt-1 whitespace-pre-wrap">{answerText}</p>}
        </div>
      )}
    </div>
  )
}

function ClarificationDetail({
  message,
  showStatus,
  leadingDivider = false,
}: {
  message: Message
  showStatus: boolean
  leadingDivider?: boolean
}) {
  const data = message.clarification
  if (!data || (data.status !== 'answered' && data.status !== 'skipped')) return null
  const questions = clarificationQuestions(data)
  return (
    <div className={cn(leadingDivider && 'mt-4 border-t border-border pt-4')}>
      {questions.map((question, index) => (
        <QuestionDetail
          key={question.id}
          question={question}
          batchStatus={data.status}
          showStatus={showStatus}
          divider={index > 0}
        />
      ))}
    </div>
  )
}

function MotifRadio({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border border-foreground text-foreground',
        disabled && 'opacity-50',
      )}
    >
      {checked ? <span className="size-2 rounded-full bg-foreground" /> : null}
    </span>
  )
}

function MotifCheckbox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-[4px] border border-foreground text-background',
        checked && 'bg-foreground',
        disabled && 'opacity-50',
      )}
    >
      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  )
}

function QuestionOptions({
  question,
  answer,
  disabled,
  onChange,
}: {
  question: ClarificationQuestionState
  answer: LocalAnswer
  disabled: boolean
  onChange: (answer: LocalAnswer) => void
}) {
  const { t } = useTranslation()
  const multi = question.selection === 'multi'
  const custom = answer.custom ?? ''

  return (
    <div>
      {question.options.length > 0 && (
        <div data-clarification-options="" className="flex flex-col gap-0.5" role={multi ? 'group' : 'radiogroup'}>
          {question.options.map(option => {
            const checked = answer.selected.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={checked}
                data-clarification-option={option.id}
                disabled={disabled}
                onClick={() => onChange({
                  custom: answer.custom,
                  selected: toggleClarificationSelection(question.selection, answer.selected, option.id),
                })}
                className={cn(
                  'flex min-h-9 w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-foreground/5',
                )}
              >
                {multi ? <MotifCheckbox checked={checked} disabled={disabled} /> : <MotifRadio checked={checked} disabled={disabled} />}
                <span className={cn('select-none', disabled && 'opacity-60')}>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
      <input
        value={custom}
        disabled={disabled}
        data-clarification-text=""
        placeholder={t('chat.clarificationFreeTextPlaceholder')}
        onChange={event => onChange({ custom: event.target.value, selected: answer.selected })}
        className={cn(
          'flex h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none',
          'placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          question.options.length > 0 && 'mt-1.5',
        )}
      />
    </div>
  )
}

function barTone({
  answered,
  current,
  hovered,
  skipped,
}: {
  answered: boolean
  current: boolean
  hovered: boolean
  skipped: boolean
}) {
  if (skipped) return 'bg-warning'
  if (current) return 'bg-foreground'
  if (hovered) return answered ? 'bg-foreground' : 'bg-foreground/45'
  return answered ? 'bg-foreground/55' : 'bg-foreground/20'
}

function stepBarState(answered: boolean, skipped: boolean, current: boolean): string {
  if (current) return 'current'
  if (skipped) return 'skipped'
  if (answered) return 'answered'
  return 'upcoming'
}

function StepBars({
  current,
  questions,
  answers,
  onSelect,
  t,
}: {
  current: number
  questions: ClarificationQuestionState[]
  answers: Record<string, LocalAnswer>
  onSelect: (index: number) => void
  t: TFunction
}) {
  const reduce = useReducedMotion() ?? false
  const [hovered, setHovered] = React.useState<string | null>(null)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-clarification-steps="">
      {questions.map((question, index) => {
        const answered = isAnswered(answers[question.id] ?? EMPTY_ANSWER)
        const skipped = index < current && !answered
        const width = hovered === question.id && !reduce
          ? BAR_HOVER_WIDTH
          : index === current
            ? BAR_CURRENT_WIDTH
            : BAR_REST_WIDTH
        const status = answered
          ? t('chat.clarificationStepAnswered')
          : skipped
            ? t('chat.clarificationStepSkipped')
            : ''
        const ariaLabel = `${t('chat.clarificationStep', { current: index + 1, total: questions.length, title: question.question })}${status}`

        return (
          <Tooltip key={question.id} delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-clarification-step-bar={question.id}
                data-clarification-bar-state={stepBarState(answered, skipped, index === current)}
                aria-label={ariaLabel}
                aria-current={index === current ? 'step' : undefined}
                onClick={() => onSelect(index)}
                onPointerEnter={() => setHovered(question.id)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(question.id)}
                onBlur={() => setHovered(null)}
                className="flex h-4 cursor-pointer items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <motion.span
                  initial={false}
                  animate={{ width }}
                  transition={reduce ? { duration: 0 } : SPRING_SWAP}
                  className={cn(
                    'h-1 rounded-full transition-colors duration-200',
                    barTone({
                      answered,
                      current: index === current,
                      hovered: hovered === question.id && !reduce,
                      skipped,
                    }),
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{question.question}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/**
 * One clarification card: Motif Question Card layout, with Selection's
 * multi-select, coexisting notes, and submit-with-skips behavior.
 */
export function ClarificationCard({
  message,
  interactive = false,
  onRespond,
  initialStep = 0,
}: ClarificationCardProps) {
  const data = message.clarification
  if (!data) return null
  if (data.status === 'answered' || data.status === 'skipped') {
    return <AnsweredClarificationCard message={message} />
  }
  if (data.status !== 'pending') return null
  return (
    <PendingClarificationCard
      message={message}
      interactive={interactive}
      onRespond={onRespond}
      initialStep={initialStep}
    />
  )
}

function AnsweredClarificationCard({ message }: { message: Message }) {
  const { t } = useTranslation()
  const data = message.clarification
  if (!data) return null
  const questions = clarificationQuestions(data)
  const current = questions[questions.length - 1]
  return (
    <section
      data-clarification-card=""
      data-clarification-status={data.status}
      data-clarification-question-count={questions.length}
      className="w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-sm text-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{current?.question ?? data.question}</p>
        <span className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground" aria-hidden="true">
          <X className="size-3.5" />
        </span>
      </div>
      <p data-clarification-result="" className="mt-2 text-sm text-muted-foreground">
        {t('chat.clarificationRecorded')}
      </p>
    </section>
  )
}

function PendingClarificationCard({
  message,
  interactive = false,
  onRespond,
  initialStep = 0,
}: ClarificationCardProps) {
  const { t } = useTranslation()
  const data = message.clarification
  const questions = data ? clarificationQuestions(data) : []
  const [answers, setAnswers] = React.useState<Record<string, LocalAnswer>>(() => (
    data ? answersFromState(data) : {}
  ))
  const [step, setStep] = React.useState(() => Math.min(Math.max(0, initialStep), Math.max(0, questions.length - 1)))
  const previousStep = React.useRef(step)
  const reduce = useReducedMotion() ?? false

  React.useEffect(() => {
    previousStep.current = step
  }, [step])

  if (!data || data.status !== 'pending') return null
  const currentStep = Math.min(Math.max(0, step), Math.max(0, questions.length - 1))
  const question = questions[currentStep]
  const currentAnswer = question ? (answers[question.id] ?? EMPTY_ANSWER) : EMPTY_ANSWER
  const lastStep = currentStep === questions.length - 1
  const canEdit = interactive
  const currentAnswered = isAnswered(currentAnswer)
  const canContinue = lastStep || currentAnswered
  const slide = reduce || currentStep === previousStep.current
    ? 0
    : currentStep > previousStep.current ? 1 : -1

  const updateCurrentAnswer = (next: LocalAnswer) => {
    if (!question) return
    setAnswers(current => ({ ...current, [question.id]: next }))
  }

  const submit = (nextAnswers = answers) => {
    if (!canEdit) return
    onRespond?.(buildResponse(questions, nextAnswers))
  }

  const skipCurrent = () => {
    if (!canEdit || !question) return
    const nextAnswers = { ...answers, [question.id]: EMPTY_ANSWER }
    setAnswers(nextAnswers)
    if (!lastStep) {
      setStep(currentStep + 1)
      return
    }
    submit(nextAnswers)
  }

  const continueOrSubmit = () => {
    if (!canEdit) return
    if (!lastStep) {
      if (!currentAnswered) return
      setStep(currentStep + 1)
      return
    }
    submit()
  }

  return (
    <TooltipProvider delayDuration={150}>
      <section
        data-clarification-card=""
        data-clarification-status={data.status}
        data-clarification-selection={question?.selection ?? data.selection}
        data-clarification-step={currentStep}
        data-clarification-question-count={questions.length}
        className="w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-sm text-foreground"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{question?.question ?? data.question}</p>
          {canEdit && (
            <button
              type="button"
              data-clarification-dismiss=""
              aria-label={t('chat.clarificationDismiss')}
              onClick={() => submit()}
              className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {question ? (
          <motion.div
            key={question.id}
            initial={{ opacity: 0, x: 8 * slide }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="mt-3"
          >
            <QuestionOptions
              question={question}
              answer={currentAnswer}
              disabled={!canEdit}
              onChange={updateCurrentAnswer}
            />
          </motion.div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <StepBars
            answers={answers}
            current={currentStep}
            onSelect={setStep}
            questions={questions}
            t={t}
          />
          {canEdit && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-clarification-skip=""
                onClick={skipCurrent}
                className="inline-flex h-8 items-center justify-center rounded-full bg-foreground/5 px-3 text-xs font-medium text-foreground hover:bg-foreground/10"
              >
                {t('chat.clarificationSkip')}
              </button>
              <button
                type="button"
                data-clarification-continue={lastStep ? undefined : ''}
                data-clarification-submit={lastStep ? '' : undefined}
                disabled={!canContinue}
                onClick={continueOrSubmit}
                className={cn(
                  'inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium',
                  lastStep || currentAnswered
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'cursor-not-allowed bg-foreground/10 text-muted-foreground',
                )}
              >
                {lastStep ? t('chat.clarificationSubmit') : t('chat.clarificationContinue')}
              </button>
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  )
}
