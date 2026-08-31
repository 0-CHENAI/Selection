import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SwarmToggleProps {
  enabled: boolean
  onEnabledChange?: (enabled: boolean) => void | Promise<void>
  disabled?: boolean
  compact?: boolean
  running?: boolean
  onStop?: () => void | Promise<void>
  tokensUsed?: number
  tokenBudget?: number
  onBudgetIncrease?: (tokenBudget: number) => void | Promise<void>
}

export function SwarmToggle({ enabled, onEnabledChange, disabled = false, compact = false, running = false, onStop, tokensUsed = 0, tokenBudget, onBudgetIncrease }: SwarmToggleProps) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const [budgetDraft, setBudgetDraft] = React.useState('')
  const toggleId = React.useId()

  const handleChange = React.useCallback(async (checked: boolean) => {
    if (!onEnabledChange || pending) return
    setPending(true)
    try {
      await onEnabledChange(checked)
    } finally {
      setPending(false)
    }
  }, [onEnabledChange, pending])

  const submitBudget = React.useCallback(async () => {
    if (!onBudgetIncrease || pending) return
    const next = Number(budgetDraft)
    if (!Number.isFinite(next) || next <= Math.max(tokensUsed, tokenBudget ?? 0)) return
    setPending(true)
    try {
      await onBudgetIncrease(next)
      setBudgetDraft('')
    } finally {
      setPending(false)
    }
  }, [budgetDraft, onBudgetIncrease, pending, tokenBudget, tokensUsed])

  return (
    <div className={cn('mb-1.5 flex items-start justify-between gap-3 px-1', compact && 'px-0.5')}>
      <div className="min-w-0">
        <label
          htmlFor={toggleId}
          className="block text-[11px] font-medium leading-4 text-foreground/70"
        >
          {t('swarm.toggleLabel')}
        </label>
        {enabled && (
          <>
            <p className="text-[10px] leading-4 text-muted-foreground">
              {t('swarm.eligibilityHint')}
            </p>
            <p className="text-[10px] leading-4 text-muted-foreground">
              {tokenBudget === undefined
                ? t('swarm.tokensUnlimited', { used: tokensUsed })
                : t('swarm.tokensBudgeted', { used: tokensUsed, budget: tokenBudget })}
            </p>
            {!disabled && onBudgetIncrease && (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min={Math.max(tokensUsed, tokenBudget ?? 0) + 1}
                  step="1"
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  placeholder={t('swarm.budgetPlaceholder')}
                  aria-label={t('swarm.budgetPlaceholder')}
                  className="h-6 w-28 rounded-md border border-border bg-background px-2 text-[10px]"
                />
                <button
                  type="button"
                  className="text-[10px] font-medium text-foreground/65 hover:underline disabled:opacity-50"
                  disabled={pending || !budgetDraft}
                  onClick={() => void submitBudget()}
                >
                  {t('swarm.updateBudget')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <Switch
        id={toggleId}
        checked={enabled}
        disabled={disabled || pending || !onEnabledChange}
        onCheckedChange={handleChange}
        aria-label={t('swarm.toggleLabel')}
        title={disabled ? t('swarm.inheritedHint') : t('swarm.toggleLabel')}
      />
      {running && onStop && (
        <button
          type="button"
          className="shrink-0 text-[10px] leading-4 text-destructive hover:underline disabled:opacity-50"
          disabled={pending}
          onClick={() => void onStop()}
        >
          {t('swarm.stopRun')}
        </button>
      )}
    </div>
  )
}
