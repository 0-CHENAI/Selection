import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, ArrowUpRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HandoverSlider } from './HandoverSlider'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { useAtomValue } from 'jotai'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { navigate, routes } from '@/lib/navigate'
import type { HandoverOperation, HandoverRecord, HandoverResult } from '@craft-agent/shared/protocol'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'

function resultRecords(result: unknown): HandoverResult {
  if (!result || typeof result !== 'object' || !('records' in result) || !Array.isArray(result.records)) throw new Error('Handover is unavailable')
  return result as HandoverResult
}

export function HandoverPanel({ sessionId, mode, canCreate, sourceLink, headerOnly = false }: {
  sessionId: string; mode: WorkMode; canCreate: boolean; sourceLink?: { handoverId: string; sourceSessionId: string }; headerOnly?: boolean
}) {
  const { t } = useTranslation()
  const { onOpenFile } = useAppShellContext()
  const metadata = useAtomValue(sessionMetaMapAtom)
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<HandoverRecord[]>([])
  const [selectedId, setSelectedId] = useState(sourceLink?.handoverId)
  const [changes, setChanges] = useState<HandoverResult['changes']>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const requestId = useRef<string | undefined>(undefined)
  const alive = useRef(true)
  const activeCall = useRef(false)
  const selected = records.find(record => record.handoverId === selectedId) ?? records[0]
  const targetMode = mode === 'NORM' ? 'PRO' : 'NORM'
  const actionLabel = mode === 'NORM' ? t('handover.toPro') : t('handover.toNorm')
  const call = useCallback(async (operation: HandoverOperation) => resultRecords(await window.electronAPI.sessionCommand(sessionId, { type: 'handover', operation })), [sessionId])
  const accept = useCallback((result: HandoverResult) => {
    if (!alive.current) return
    setRecords(previous => operationMerge(previous, result.records))
    if (result.records[0]) setSelectedId(result.records[0].handoverId)
    setChanges(result.changes)
  }, [])
  useEffect(() => {
    alive.current = true
    const refresh = () => void call({ type: 'list' }).then(result => {
      if (alive.current) {
        setRecords(result.records)
        const id = selectedRef.current ?? sourceLink?.handoverId ?? result.records[0]?.handoverId
        setSelectedId(id)
      }
    }).catch(reason => { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)) })
    refresh()
    if (open && selectedRef.current) void call({ type: 'get', handoverId: selectedRef.current }).then(accept).catch(() => {})
    window.addEventListener('selection-handover-updated', refresh)
    return () => { alive.current = false; window.removeEventListener('selection-handover-updated', refresh) }
  }, [call, sourceLink?.handoverId, open, accept])
  const waitingId = selected?.status === 'waiting' ? selected.handoverId : undefined
  useEffect(() => {
    if (!waitingId) return
    const timer = setInterval(() => {
      if (activeCall.current) return
      activeCall.current = true
      void call({ type: 'get', handoverId: waitingId }).then(accept).catch(reason => { if (alive.current) setError(String(reason.message ?? reason)) }).finally(() => { activeCall.current = false })
    }, 2000)
    return () => clearInterval(timer)
  }, [waitingId, call, accept])
  const run = async (operation: HandoverOperation) => {
    if (activeCall.current) return
    activeCall.current = true; setBusy(true); setError(undefined)
    try { accept(await call(operation)); window.dispatchEvent(new Event('selection-handover-updated')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { activeCall.current = false; if (alive.current) setBusy(false) }
  }
  const begin = () => {
    const pending = records.find(record => record.sourceSessionId === sessionId && ['waiting','prepared','created'].includes(record.status))
    requestId.current ??= pending?.handoverId ?? crypto.randomUUID()
    void run({ type: 'create', handoverId: requestId.current, targetMode })
  }
  const targetOwned = selected?.targetSessionId === sessionId
  const unknown = selected?.snapshot?.actions.filter(action => action.outcome === 'unknown' && !selected.reviews[action.ref]) ?? []
  const sourceExists = selected ? metadata.has(selected.sourceSessionId) : sourceLink ? metadata.has(sourceLink.sourceSessionId) : false
  return <>
    {headerOnly ? canCreate && <HandoverSlider key={`${sessionId}:${mode}`} mode={mode} disabled={busy || open} onActivate={() => setOpen(true)} />
      : sourceLink && <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.02] px-3 py-2 text-xs">
        <ArrowRightLeft className="size-3.5 text-muted-foreground" /><span>{t('handover.backgroundReady')}</span>
        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors" disabled={!metadata.has(sourceLink.sourceSessionId)} onClick={() => navigate(routes.view.allSessions(sourceLink.sourceSessionId))}>{metadata.has(sourceLink.sourceSessionId) ? t('handover.openSource') : t('handover.sourceRemoved')}</button>
        <button type="button" className="ml-auto text-muted-foreground hover:text-foreground transition-colors" onClick={() => setOpen(true)}>{t('handover.viewBackground')}</button>
        {unknown.length > 0 && <span role="status" className="w-full text-warning">{t('handover.unknownBlocked', { count: unknown.length })}</span>}
      </div>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex w-[calc(100%-2rem)] max-h-[80dvh] sm:max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle>{t('handover.title')}</DialogTitle><DialogDescription>{t('handover.description')}</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {records.length === 0 && <p className="text-sm text-muted-foreground">{t('handover.empty')}</p>}
          {records.length > 1 && <div className="flex flex-wrap gap-2">{records.map(record => <button key={record.handoverId} type="button" className={`rounded-md px-2 py-1 text-xs ${selected?.handoverId === record.handoverId ? 'bg-foreground/10' : 'text-muted-foreground'}`} onClick={() => { setSelectedId(record.handoverId); void run({ type: 'get', handoverId: record.handoverId }) }}>{record.targetMode} · {t(`handover.status.${record.status}`)}</button>)}</div>}
          {selected && <>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-md bg-foreground/5 px-2 py-1">{selected.targetMode}</span><span role="status">{t(`handover.status.${selected.status}`)}</span></div>
            {selected.status === 'waiting' && <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">{t('handover.waiting')}</p>}
            {selected.error && selected.status !== 'waiting' && <p role="alert" className="text-sm text-destructive">{selected.error}</p>}
            {selected.snapshot && <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run({ type: 'get', handoverId: selected.handoverId, checkSources: true })}>{t('handover.checkSources')}</Button>
              <Detail title={t('handover.goal')} values={[...selected.snapshot.goal, ...selected.snapshot.acceptance]} />
              <Detail title={t('handover.constraints')} values={selected.snapshot.constraints} />
              <Detail title={t('handover.decisions')} values={selected.snapshot.decisions} />
              <Detail title={t('handover.scope')} values={selected.snapshot.scopeAndPriority} />
              <Detail title={t('handover.openQuestions')} values={selected.snapshot.openQuestions} />
              <Detail title={t('handover.nextSteps')} values={selected.snapshot.nextSteps} />
              {selected.snapshot.files.length > 0 && <section className="space-y-2"><h3 className="text-xs font-medium text-muted-foreground">{t('handover.files')}</h3>{selected.snapshot.files.map(file => <div key={file.ref} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 text-xs"><span className="min-w-0 flex-1 break-all">{file.originalPath.split(/[\\/]/).at(-1)}</span><code className="text-muted-foreground">{file.hash.slice(0,12)}</code>{file.versionId && <span>{t('handover.frozenVersion')}</span>}{changes?.find(change => change.ref === file.ref)?.state !== 'unchanged' && changes?.some(change => change.ref === file.ref) && <span className="text-warning">{t(`handover.fileState.${changes.find(change => change.ref === file.ref)!.state}`)}</span>}<button type="button" className="text-muted-foreground hover:text-foreground" disabled={!selected.targetSessionId} onClick={() => { if (selected.targetSessionId) void window.electronAPI.getSessionMessages(selected.targetSessionId).then(target => { if (target?.sessionFolderPath) onOpenFile(`${target.sessionFolderPath}/data/handover/${selected.handoverId}/${file.snapshotPath}`) }) }}>{t('handover.openSnapshot')}</button></div>)}</section>}
              <Detail title={t('handover.completedActions')} values={selected.snapshot.actions.filter(action => action.outcome === 'completed' || selected.reviews[action.ref]?.outcome === 'completed').map(action => `${action.tool}: ${action.evidence}`)} />
              {selected.snapshot.warnings.some(warning => warning.startsWith('Input snapshot unavailable:') || warning.includes('omitted')) && <p role="status" className="rounded-lg bg-warning/10 p-3 text-xs text-warning">{t('handover.incompleteFiles')}</p>}
              {unknown.map(action => <OperationReview key={action.ref} text={action.evidence} tool={action.tool} disabled={busy || !targetOwned} onSave={(outcome, note) => run({ type: 'review', handoverId: selected.handoverId, actionRef: action.ref, outcome, note })} />)}
              <p className="text-xs leading-relaxed text-muted-foreground">{t('handover.evidenceNotice')}</p>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('handover.originals')}</summary><div className="mt-2 space-y-2">{selected.snapshot.originals.map((original, index) => <div key={`${original.sessionId}-${original.id}-${index}`} className="whitespace-pre-wrap break-words rounded-md bg-foreground/5 p-2">{original.text}</div>)}</div></details>
            </>}
          </>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.close')}</Button>
          {selected && <Button variant="ghost" disabled={busy || !sourceExists} onClick={() => navigate(routes.view.allSessions(selected.sourceSessionId))}>{sourceExists ? t('handover.openSource') : t('handover.sourceRemoved')}</Button>}
          <div className="ml-auto flex flex-wrap gap-2">
            {selected?.status === 'waiting' && <Button variant="outline" disabled={busy} onClick={() => void run({ type: 'cancel', handoverId: selected.handoverId })}>{t('handover.cancelWait')}</Button>}
            {selected?.status === 'applied' && selected.targetSessionId && <Button onClick={() => navigate(routes.view.allSessions(selected.targetSessionId!))}><ArrowUpRight className="mr-1.5 size-3.5" />{t('handover.openTarget')}</Button>}
            {canCreate && (!selected || selected.status !== 'waiting') && <Button variant={selected ? 'outline' : 'default'} disabled={busy} onClick={() => { if (selected?.status === 'applied' || selected?.status === 'cancelled') requestId.current = undefined; begin() }}>{busy && <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />}{selected?.status === 'prepared' || selected?.status === 'created' ? t('handover.retry') : selected ? t('handover.newSnapshot') : actionLabel}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}

function operationMerge(previous: HandoverRecord[], updates: HandoverRecord[]) {
  const byId = new Map(previous.map(record => [record.handoverId, record]))
  for (const record of updates) byId.set(record.handoverId, record)
  return [...byId.values()].sort((a,b) => b.createdAt - a.createdAt)
}
function Detail({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null
  return <section className="space-y-1.5"><h3 className="text-xs font-medium text-muted-foreground">{title}</h3><ul className="space-y-1 text-sm">{[...new Set(values)].map((value,index) => <li key={index} className="whitespace-pre-wrap break-words">{value}</li>)}</ul></section>
}
function OperationReview({ text, tool, disabled, onSave }: { text: string; tool: string; disabled: boolean; onSave: (outcome: 'completed' | 'not-performed', note: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [outcome, setOutcome] = useState<'completed' | 'not-performed'>()
  const [note, setNote] = useState('')
  return <section className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3"><h3 className="text-sm font-medium">{t('handover.reviewOperation', { tool })}</h3><p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{text}</p><div className="flex flex-wrap gap-2">{(['completed','not-performed'] as const).map(value => <Button key={value} variant={outcome === value ? 'default' : 'outline'} size="sm" disabled={disabled} aria-pressed={outcome === value} onClick={() => setOutcome(value)}>{t(`handover.outcome.${value}`)}</Button>)}</div><textarea aria-label={t('handover.reviewNote')} placeholder={t('handover.reviewNote')} className="min-h-16 w-full resize-y rounded-md border border-border bg-background p-2 text-sm" value={note} onChange={event => setNote(event.target.value)} disabled={disabled} /><Button size="sm" disabled={disabled || !outcome || !note.trim()} onClick={() => { if (outcome) void onSave(outcome,note) }}>{t('handover.saveReview')}</Button></section>
}
