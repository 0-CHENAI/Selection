import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import { taskProposalChanges } from './task-proposal-diff'
import type { TaskGenerateResult, TaskProposalTurn } from '@craft-agent/shared/protocol'
type PendingProposal = { sessionId?: string; cancelled: boolean; off?: () => void; timer?: ReturnType<typeof setTimeout> }

/** Slightly above the server generate timeout so a late GENERATED event can still settle. */
export const PROPOSAL_UI_TIMEOUT_MS = 195_000

/** A conversation survives editor tabs. Applying changes only the unsaved draft. */
export function TaskProposal(props: {
  workspaceId: string; currentYaml?: string; draftIdentity: string; projectId?: string; model?: string;
  llmConnection?: string; disabled?: boolean; onApply: (spec: unknown) => void;
}) {
  const { t } = useTranslation()
  const [goal, setGoal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [error, setError] = React.useState('')
  const [proposal, setProposal] = React.useState<TaskGenerateResult | null>(null)
  const [conversation, setConversation] = React.useState<TaskProposalTurn[]>([])
  const proposalBase = React.useRef<string | undefined>(undefined)
  const latest = React.useRef(props)
  latest.current = props
  const pending = React.useRef<PendingProposal | null>(null)
  const mounted = React.useRef(true)
  const cancel = React.useCallback(() => {
    const request = pending.current
    if (!request) return
    request.cancelled = true
    request.off?.()
    clearTimeout(request.timer)
    if (request.sessionId) void window.electronAPI.deleteSession(request.sessionId).catch(() => {})
    pending.current = null
  }, [])
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel() } }, [cancel])

  async function generate() {
    if (pending.current || !goal.trim() || applying) return
    setBusy(true)
    setError('')
    // Continue an unapplied proposal only while the actual editor has not changed underneath it.
    const currentYaml = proposal && proposalBase.current === props.draftIdentity ? proposal.yaml : props.currentYaml
    const history = conversation.map(turn => turn.status === 'proposed' ? { ...turn, status: 'superseded' as const } : turn)
    const round = history.length
    setConversation([...history, { goal: goal.trim(), status: 'proposed' }])
    setProposal(null)
    proposalBase.current = props.draftIdentity
    const request: PendingProposal = { cancelled: false }
    pending.current = request
    const early = new Map<string, TaskGenerateResult>()
    const receive = (result: TaskGenerateResult) => {
      if (request.cancelled) return
      request.off?.()
      clearTimeout(request.timer)
      pending.current = null
      setBusy(false)
      const valid = !result.error && result.validation.valid && !!result.spec
      setConversation(turns => turns.map((turn, index) => index === round ? { ...turn, yaml: valid ? result.yaml : undefined, status: valid ? 'proposed' : 'failed' } : turn))
      if (!valid) setError(result.error || result.validation.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
      else { setProposal(result); setGoal('') }
    }
    request.off = window.electronAPI.onTaskGenerated((workspaceId, result) => {
      if (workspaceId !== props.workspaceId || request.cancelled) return
      if (!request.sessionId) early.set(result.orchestratorSessionId, result)
      else if (request.sessionId === result.orchestratorSessionId) receive(result)
    })
    request.timer = setTimeout(() => {
      cancel()
      setBusy(false)
      setConversation(turns => turns.map((turn, index) => index === round ? { ...turn, status: 'failed' } : turn))
      setError(t('tasks.proposalTimeout'))
    }, PROPOSAL_UI_TIMEOUT_MS)
    try {
      const ack = await window.electronAPI.generateTask(props.workspaceId, {
        goal: goal.trim(), currentYaml, conversation: history, projectId: props.projectId,
        model: props.model, llmConnection: props.llmConnection,
      })
      request.sessionId = ack.orchestratorSessionId
      if (request.cancelled) {
        void window.electronAPI.deleteSession(ack.orchestratorSessionId).catch(() => {})
        return
      }
      const result = early.get(ack.orchestratorSessionId)
      early.clear()
      if (result) receive(result)
    } catch (err) {
      if (request.cancelled) return
      cancel()
      setBusy(false)
      setConversation(turns => turns.map((turn, index) => index === round ? { ...turn, status: 'failed' } : turn))
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function apply() {
    if (!proposal || applying) return
    if (proposalBase.current !== latest.current.draftIdentity) { setError(t('tasks.proposalStale')); return }
    setApplying(true)
    setError('')
    try {
      // Validate at the point of application too; events and previews are not a validation boundary.
      const result = await window.electronAPI.validateTask(props.workspaceId, proposal.yaml)
      if (!mounted.current) return
      if (!result.valid || !result.spec) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('\n') || t('tasks.proposalFailed'))
      if (proposalBase.current !== latest.current.draftIdentity) { setError(t('tasks.proposalStale')); return }
      latest.current.onApply(result.spec)
      setConversation(turns => turns.map(turn => turn.status === 'proposed' ? { ...turn, status: 'applied' } : turn))
      setProposal(null)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err))
    } finally { if (mounted.current) setApplying(false) }
  }

  let base: unknown
  try { base = JSON.parse(props.draftIdentity) } catch { base = {} }
  const changes = proposal ? taskProposalChanges(base, proposal.spec) : []
  const display = (value: unknown) => value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <section className="space-y-3" aria-busy={busy || applying}>
    <details open={conversation.length > 0 || !(base as WorkbenchSpec | undefined)?.nodes?.length}>
      <summary className="cursor-pointer text-sm font-medium">{t('tasks.proposalTitle')}</summary>
      <p className="py-2 text-xs text-muted-foreground">{t('tasks.proposalHint')}</p>
      {conversation.length > 0 && <ol aria-label={t('tasks.proposalConversation')} className="mb-3 max-h-48 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-3">
        {conversation.map((turn, index) => <li key={index} className="space-y-1 text-sm">
          <p className="whitespace-pre-wrap break-words">{index + 1}. {turn.goal}</p>
          <span className="text-xs text-muted-foreground">{busy && index === conversation.length - 1 ? t('tasks.proposalBusy') : t(`tasks.proposalStatus_${turn.status}`)}</span>
        </li>)}
      </ol>}
      <textarea aria-label={t('tasks.proposalGoal')} placeholder={t(conversation.length ? 'tasks.proposalContinueHint' : 'tasks.proposalInitialHint')} value={goal} onChange={e => setGoal(e.target.value)} disabled={busy || applying}
        className="w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" rows={3} maxLength={50000} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => void generate()} disabled={busy || applying || props.disabled || !goal.trim()}>{t(busy ? 'tasks.proposalBusy' : conversation.length ? 'tasks.proposalContinue' : 'tasks.proposalGenerate')}</Button>
        {busy && <Button variant="ghost" onClick={() => { cancel(); setBusy(false); setConversation(turns => turns.map(turn => !turn.yaml && turn.status === 'proposed' ? { ...turn, status: 'discarded' } : turn)) }}>{t('common.cancel')}</Button>}
      </div>
      {error && <p role="alert" className="mt-2 whitespace-pre-wrap break-words text-sm text-destructive">{t('tasks.proposalFailed')} {error}</p>}
      {proposal && <div className="space-y-3 pt-3">
        <p role="status" className="text-sm font-medium">{t('tasks.proposalReview')}</p>
        <div aria-label={t('tasks.proposalChanges')} className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
          {changes.length === 0 && <p className="text-sm text-muted-foreground">{t('tasks.proposalNoChanges')}</p>}
          {changes.map(change => <div key={change.path} className="space-y-1 text-xs">
            <p className="break-words font-mono font-medium">{change.path}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><span className="text-muted-foreground">{t('tasks.proposalBefore')}</span><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/50 p-2">{display(change.before)}</pre></div>
              <div><span className="text-muted-foreground">{t('tasks.proposalAfter')}</span><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-accent/50 p-2">{display(change.after)}</pre></div>
            </div>
          </div>)}
        </div>
        <div className="flex h-80 min-h-0 flex-col"><ConductorWorkbench compact spec={proposal.spec as WorkbenchSpec} /></div>
        <details><summary className="cursor-pointer text-xs">{t('tasks.proposalYamlPreview')}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{proposal.yaml}</pre></details>
        <div className="flex flex-wrap gap-2">
          <Button disabled={props.disabled || applying} onClick={() => void apply()}>{t('tasks.proposalApply')}</Button>
          <Button variant="ghost" disabled={applying} onClick={() => { setProposal(null); setError(''); setConversation(turns => turns.map(turn => turn.status === 'proposed' ? { ...turn, status: 'discarded' } : turn)) }}>{t('tasks.proposalReject')}</Button>
        </div>
      </div>}
    </details>
  </section>
}
