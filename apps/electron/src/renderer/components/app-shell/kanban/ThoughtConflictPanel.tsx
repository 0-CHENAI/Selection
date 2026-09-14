import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { WorkbenchEditConflict } from '@craft-agent/shared/thought-workbench/merge'

function preview(value: unknown): string {
  if (value === undefined) return '∅'
  if (typeof value === 'string') return value || '∅'
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function ThoughtConflictPanel(props: {
  conflict: WorkbenchEditConflict
  busy?: boolean
  onKeepMine: () => void
  onKeepTheirs: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <div role="alertdialog" aria-labelledby="thought-conflict-title" data-testid="thought-conflict-panel" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-foreground/80">
      <div id="thought-conflict-title" className="font-semibold">{t('thought.conflictTitle')}</div>
      <p>{t('thought.conflictHint')}</p>
      <p><span className="text-muted-foreground">{t('thought.conflictPath')}</span> <code className="break-all font-mono">{props.conflict.path || '/'}</code></p>
      <div className="grid gap-2 sm:grid-cols-2">
        <section className="min-w-0">
          <h3 className="text-xs font-medium">{t('thought.conflictMine')}</h3>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/70 p-2">{preview(props.conflict.localValue)}</pre>
        </section>
        <section className="min-w-0">
          <h3 className="text-xs font-medium">{t('thought.conflictTheirs')}</h3>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/70 p-2">{preview(props.conflict.remoteValue)}</pre>
        </section>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={props.busy} onClick={props.onKeepMine}>{t('thought.conflictKeepMine')}</Button>
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onKeepTheirs}>{t('thought.conflictKeepTheirs')}</Button>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onDismiss}>{t('common.close')}</Button>
      </div>
    </div>
  )
}
