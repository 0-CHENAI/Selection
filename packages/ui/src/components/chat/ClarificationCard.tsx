import * as React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Message } from '@craft-agent/core/types'
import { canSubmitClarification, toggleClarificationSelection } from '@craft-agent/shared/agent/clarification'
import { cn } from '../../lib/utils'

const NOTE_LINE_PX = 20
const NOTE_PAD_PX = 16
const NOTE_MIN_LINES = 2
const NOTE_MAX_LINES = 5

export function clarificationNoteLayout(
  scrollHeight: number,
  scrollTop: number,
  metrics: { line?: number; pad?: number } = {},
) {
  const line = metrics.line && metrics.line > 0 ? metrics.line : NOTE_LINE_PX
  const pad = metrics.pad != null && metrics.pad >= 0 ? metrics.pad : NOTE_PAD_PX
  const min = line * NOTE_MIN_LINES + pad
  const max = line * NOTE_MAX_LINES + pad
  const height = Math.min(Math.max(scrollHeight, min), max)
  const overflows = scrollHeight > max + 1
  return { height, overflows, fadeTop: overflows && scrollTop > 1 }
}

export interface ClarificationResponse {
  skipped: boolean
  optionIds: string[]
  text: string
}

export interface ClarificationCardProps {
  message: Message
  interactive?: boolean
  onRespond?: (response: ClarificationResponse) => void
}

export interface ClarificationSummaryProps {
  messages: readonly Message[]
}

export function clarificationOutcomeCounts(messages: readonly Message[]): { answered: number; skipped: number } {
  let answered = 0
  let skipped = 0
  for (const message of messages) {
    const status = message.clarification?.status
    if (status === 'answered') answered += 1
    else if (status === 'skipped') skipped += 1
  }
  return { answered, skipped }
}

/** One settled question uses the short badge. Mixed groups always include both counts. */
export function clarificationSummaryLabel(
  counts: { answered: number; skipped: number },
  t: TFunction,
): string {
  const { answered, skipped } = counts
  if (answered > 0 && skipped > 0) return t('chat.clarificationSummaryMixed', { answered, skipped })
  if (skipped > 1) return t('chat.clarificationSkippedCount_other', { count: skipped })
  if (skipped === 1) return t('chat.clarificationSkippedCount_one')
  if (answered > 1) return t('chat.clarificationAnswered_other', { count: answered })
  return t('chat.clarificationAnswered_one')
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

/**
 * Question, options, and the answer or skip note. The process fold owns the
 * status title; this is only the body revealed when that fold opens.
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
  const markStatus = showStatus ?? settled.length > 1
  return (
    <div data-clarification-fold="" className="flex flex-col gap-3 py-1">
      {settled.map(message => (
        <ClarificationDetail key={message.id} message={message} showStatus={markStatus} />
      ))}
    </div>
  )
}

/** Settled clarification body. The chat stream renders this inside the process fold. */
export function ClarificationSummary({ messages }: ClarificationSummaryProps) {
  return <ClarificationFoldDetails messages={messages} />
}

function ClarificationDetail({ message, showStatus }: { message: Message; showStatus: boolean }) {
  const { t, i18n } = useTranslation()
  const data = message.clarification
  if (!data || (data.status !== 'answered' && data.status !== 'skipped')) return null
  const selected = new Set(data.selectedOptionIds ?? [])
  const labels = data.options.filter(option => selected.has(option.id)).map(option => option.label)
  const skipped = data.status === 'skipped'
  const answerText = data.text?.trim()
  const joined = labels.join(i18n.language?.startsWith('zh') ? '、' : ', ')
  return (
    <div data-clarification-detail="" data-clarification-status={data.status}>
      {showStatus && (
        <p className="text-xs text-muted-foreground">
          {clarificationSummaryLabel(skipped ? { answered: 0, skipped: 1 } : { answered: 1, skipped: 0 }, t)}
        </p>
      )}
      <h3 className={cn('text-sm font-medium text-foreground', showStatus && 'mt-1')}>{data.question}</h3>
      {data.options.length > 0 && (
        <ul data-clarification-options="" className="mt-3 flex flex-col gap-2">
          {data.options.map(option => {
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
        <p data-clarification-skipped="" className="mt-3 rounded-[10px] bg-foreground/[0.04] px-3 py-2 text-sm text-foreground">
          {t('chat.clarificationSkipped')}
        </p>
      ) : (labels.length > 0 || answerText) && (
        <div data-clarification-answer="" className="mt-3 rounded-[10px] bg-foreground/[0.04] px-3 py-2 text-sm text-foreground">
          <p className="text-xs text-muted-foreground">{t('chat.clarificationYourAnswer')}</p>
          {labels.length > 0 && <p className="mt-1">{joined}</p>}
          {answerText && <p className="mt-1 whitespace-pre-wrap">{answerText}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * One clarification card: choices and a free-text field together.
 * This is not the final answer card.
 */
export function ClarificationCard({ message, interactive = false, onRespond }: ClarificationCardProps) {
  const status = message.clarification?.status
  // Answered and skipped clarifications live in the process fold, not a second card.
  if (status === 'answered' || status === 'skipped') return null
  return <PendingClarificationCard message={message} interactive={interactive} onRespond={onRespond} />
}

function PendingClarificationCard({ message, interactive = false, onRespond }: ClarificationCardProps) {
  const { t } = useTranslation()
  const data = message.clarification
  const [selected, setSelected] = React.useState<string[]>(data?.selectedOptionIds ?? [])
  const [text, setText] = React.useState(data?.text ?? '')
  if (!data || data.status !== 'pending') return null
  const canEdit = interactive
  const hint = data.options.length === 0
    ? t('chat.clarificationTextHint')
    : data.selection === 'multi' ? t('chat.clarificationMultiHint') : t('chat.clarificationSingleHint')
  const submitEnabled = canSubmitClarification({ skipped: false, optionIds: selected, text })

  return (
    <section
      data-clarification-card=""
      data-clarification-status={data.status}
      data-clarification-selection={data.selection}
      className="rounded-xl border border-border bg-background px-4 py-3 text-foreground"
    >
      <p className="text-xs text-muted-foreground">{t('chat.clarificationTitle')}</p>
      <h3 className="mt-1 text-sm font-medium text-foreground">{data.question}</h3>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      {data.options.length > 0 && (
        <div data-clarification-options="" className="mt-3 flex flex-col gap-2">
          {data.options.map(option => {
            const checked = selected.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={checked}
                data-clarification-option={option.id}
                disabled={!canEdit}
                onClick={() => setSelected(current => toggleClarificationSelection(data.selection, current, option.id))}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm text-foreground',
                  checked ? 'border-foreground bg-foreground/5' : 'border-border bg-background hover:bg-muted',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-3">
        <label className="block text-xs text-muted-foreground" htmlFor={`clarification-${message.id}`}>
          {t('chat.clarificationFreeText')}
        </label>
        <ClarificationNoteField
          id={`clarification-${message.id}`}
          value={text}
          readOnly={!canEdit}
          placeholder={t('chat.clarificationFreeTextPlaceholder')}
          onChange={setText}
        />
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            data-clarification-skip=""
            onClick={() => onRespond?.({ skipped: true, optionIds: [], text: '' })}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('chat.clarificationSkip')}
          </button>
          <button
            type="button"
            data-clarification-continue=""
            disabled={!submitEnabled}
            onClick={() => onRespond?.({ skipped: false, optionIds: selected, text: text.trim() })}
            className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
          >
            {t('chat.clarificationContinue')}
          </button>
        </div>
      )}
    </section>
  )
}

function ClarificationNoteField({
  id,
  value,
  readOnly,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  readOnly: boolean
  placeholder: string
  onChange: (value: string) => void
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [layout, setLayout] = React.useState(() => clarificationNoteLayout(0, 0))

  const measure = React.useCallback(() => {
    const element = ref.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    const pinBottom = distanceFromBottom < 8
    const computed = getComputedStyle(element)
    const line = Number.parseFloat(computed.lineHeight)
    const pad = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom)
    element.style.height = 'auto'
    const fullHeight = element.scrollHeight
    const measured = { line: Number.isFinite(line) ? line : undefined, pad: Number.isFinite(pad) ? pad : undefined }
    element.style.height = `${clarificationNoteLayout(fullHeight, element.scrollTop, measured).height}px`
    if (pinBottom && element.scrollTop + element.clientHeight < element.scrollHeight - 1) {
      element.scrollTop = element.scrollHeight
    }
    const next = clarificationNoteLayout(fullHeight, element.scrollTop, measured)
    setLayout(current => (
      current.height === next.height && current.overflows === next.overflows && current.fadeTop === next.fadeTop
        ? current
        : next
    ))
  }, [])

  React.useLayoutEffect(() => {
    measure()
  }, [measure, value])

  return (
    <div className="relative mt-1.5 rounded-[10px] bg-foreground/[0.04] focus-within:ring-1 focus-within:ring-foreground/15">
      <textarea
        ref={ref}
        id={id}
        data-clarification-text=""
        data-clarification-note-fade={layout.fadeTop ? 'on' : 'off'}
        value={value}
        rows={NOTE_MIN_LINES}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onScroll={measure}
        style={{
          height: layout.height,
          scrollbarWidth: layout.overflows ? 'thin' : undefined,
          maskImage: layout.fadeTop ? 'linear-gradient(to bottom, transparent 0, #000 1.75rem, #000 100%)' : undefined,
          WebkitMaskImage: layout.fadeTop ? 'linear-gradient(to bottom, transparent 0, #000 1.75rem, #000 100%)' : undefined,
        }}
        className={cn(
          'block w-full resize-none bg-transparent px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/75',
          layout.overflows ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      />
    </div>
  )
}
