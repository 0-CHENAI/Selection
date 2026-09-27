import * as React from 'react'
import { AlertTriangle, RefreshCw, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeRecoveryView } from '@craft-agent/shared/protocol'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function ExecutionRecoveryStatus({ state, onResume }: { state?: RuntimeRecoveryView; onResume: () => Promise<unknown> }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [details, setDetails] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string>()
  if (!state || !['recovering', 'blocked'].includes(state.phase)) return null
  const title = t(state.phase === 'recovering' ? 'chat.recovery.recovering' : 'chat.recovery.attention')
  const Icon = state.phase === 'recovering' ? LoaderCircle : AlertTriangle
  const reason = t(`chat.recovery.reasons.${state.reason ?? 'checking'}`, { defaultValue: t('chat.recovery.reasons.unknown') })
  const content = <div className="space-y-3 text-sm">
    <p>{reason}</p>
    <p className="text-muted-foreground">{t('chat.recovery.completed', { count: state.completedSteps })}</p>
    {state.pendingTools.length > 0 && <ul className="max-h-48 overflow-auto list-disc pl-5">{state.pendingTools.map((name, i) => <li key={i} className="break-all">{name}</li>)}</ul>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {state.canResume && <Button disabled={pending} onClick={() => {
      setPending(true); setError(undefined)
      void onResume().catch(e => setError(String(e))).finally(() => setPending(false))
    }}><RefreshCw className="size-4" />{t('chat.recovery.resume')}</Button>}
  </div>
  return <div className="px-6 py-2">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-sm"><Icon className="size-3.5" />{title}</button></PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] max-w-[calc(100vw-2rem)] space-y-3">
        <p className="font-medium">{title}</p>{content}
        <Button variant="ghost" onClick={() => { setOpen(false); setDetails(true) }}>{t('chat.recovery.details')}</Button>
      </PopoverContent>
    </Popover>
    <Dialog open={details} onOpenChange={setDetails}><DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t('chat.recovery.description')}</DialogDescription></DialogHeader>{content}
    </DialogContent></Dialog>
  </div>
}
