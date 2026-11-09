import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export interface ContextLimitRecoveryOptions {
  disabled?: boolean
  onCompact: () => Promise<void>
  onChooseModel?: () => void
  onNewDraft?: () => Promise<void>
}

export function ContextLimitRecoveryActions({ disabled, onCompact, onChooseModel, onNewDraft }: ContextLimitRecoveryOptions) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState<string>()
  const [error, setError] = React.useState<string>()
  const lock = React.useRef(false)
  const run = async (key: string, action: () => void | Promise<void>) => {
    if (disabled || lock.current) return
    lock.current = true; setPending(key); setError(undefined)
    try { await action() }
    catch { setError(t('chat.contextRecovery.failed')) }
    finally { lock.current = false; setPending(undefined) }
  }
  return <div className="mt-3 space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button className="max-w-full h-auto min-h-8 whitespace-normal text-left" size="sm" variant="outline" disabled={disabled || !!pending} onClick={() => { void run('compact', onCompact) }}>
        {t(pending === 'compact' ? 'chat.contextRecovery.compacting' : 'chat.contextRecovery.compact')}
      </Button>
      {onChooseModel && <Button className="max-w-full h-auto min-h-8 whitespace-normal text-left" size="sm" variant="outline" disabled={disabled || !!pending} onClick={() => { void run('model', onChooseModel) }}>
        {t('chat.contextRecovery.chooseModel')}
      </Button>}
      {onNewDraft && <Button className="max-w-full h-auto min-h-8 whitespace-normal text-left" size="sm" variant="outline" disabled={disabled || !!pending} onClick={() => { void run('draft', onNewDraft) }}>
        {t(pending === 'draft' ? 'chat.contextRecovery.preparingDraft' : 'chat.contextRecovery.newDraft')}
      </Button>}
    </div>
    {error && <p role="alert" className="text-sm text-[color:var(--destructive-text)]">{error}</p>}
  </div>
}
