import * as React from 'react'
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

/**
 * One clarification card: choices and a free-text field together.
 * This is not the final answer card.
 */
export function ClarificationCard({ message, interactive = false, onRespond }: ClarificationCardProps) {
  const { t, i18n } = useTranslation()
  const data = message.clarification
  const [selected, setSelected] = React.useState<string[]>(data?.selectedOptionIds ?? [])
  const [text, setText] = React.useState(data?.text ?? '')
  if (!data) return null
  const pending = data.status === 'pending'
  const canEdit = interactive && pending
  const labels = data.options.filter(option => (data.selectedOptionIds ?? []).includes(option.id)).map(option => option.label)
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
      {pending ? (
        <>
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
        </>
      ) : (
        <div className="mt-2 text-sm text-foreground">
          {data.status === 'skipped' ? (
            <p data-clarification-skipped="">{t('chat.clarificationSkipped')}</p>
          ) : (
            <div data-clarification-answer="">
              <p className="text-xs text-muted-foreground">{t('chat.clarificationYourAnswer')}</p>
              {labels.length > 0 && <p className="mt-1">{labels.join(i18n.language?.startsWith('zh') ? '、' : ', ')}</p>}
              {data.text?.trim() && <p className="mt-1 whitespace-pre-wrap">{data.text}</p>}
            </div>
          )}
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
