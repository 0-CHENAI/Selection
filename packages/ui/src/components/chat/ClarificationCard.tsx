import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@craft-agent/core/types'
import { canSubmitClarification, toggleClarificationSelection } from '@craft-agent/shared/agent/clarification'
import { cn } from '../../lib/utils'

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
          <label className="mt-3 block text-xs text-muted-foreground" htmlFor={`clarification-${message.id}`}>
            {t('chat.clarificationFreeText')}
            <textarea
              id={`clarification-${message.id}`}
              data-clarification-text=""
              value={text}
              rows={3}
              readOnly={!canEdit}
              placeholder={t('chat.clarificationFreeTextPlaceholder')}
              onChange={event => setText(event.target.value)}
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
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
