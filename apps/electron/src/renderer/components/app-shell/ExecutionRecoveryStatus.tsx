import * as React from 'react'
import { RefreshCw, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeRecoveryView } from '@craft-agent/shared/protocol'

export function ExecutionRecoveryStatus({ state, onResume }: { state?: RuntimeRecoveryView; onResume: () => Promise<unknown> }) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string>()
  if (!state || !['recovering', 'blocked'].includes(state.phase)) return null
  const reason = t(`chat.recovery.reasons.${state.reason ?? 'checking'}`, { defaultValue: t('chat.recovery.reasons.unknown') })
  return <div className="space-y-2 text-xs leading-relaxed text-destructive/70">
    {state.phase === 'recovering' && <p className="flex items-center gap-1.5 text-accent"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />{t('chat.recovery.recovering')}</p>}
    <p className="text-destructive/80">{reason}</p>
    <p className="text-xs text-destructive/60">{t('chat.recovery.completed', { count: state.completedSteps })}</p>
    {state.pendingTools.length > 0 && <ul className="max-h-40 space-y-1 overflow-auto rounded-md bg-foreground/[0.03] px-2.5 py-2 font-mono text-xs text-destructive/60">{state.pendingTools.map((name, i) => <li key={i} className="break-all">{name}</li>)}</ul>}
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {state.canResume && <button type="button" className="inline-flex items-center gap-1 rounded border border-destructive/20 px-2 py-0.5 text-xs text-destructive/70 transition-colors hover:text-destructive hover:border-destructive/40 disabled:opacity-50" disabled={pending} onClick={() => {
      setPending(true); setError(undefined)
      void onResume().catch(e => setError(String(e))).finally(() => setPending(false))
    }}><RefreshCw className={`size-3 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />{t('chat.recovery.resume')}</button>}
  </div>
}
