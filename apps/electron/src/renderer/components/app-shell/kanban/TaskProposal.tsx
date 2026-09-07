import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import type { TaskGenerateResult } from '@craft-agent/shared/protocol'
type PendingProposal = { sessionId?: string; cancelled: boolean; off?: () => void; timer?: ReturnType<typeof setTimeout> }

/** Slightly above the server generate timeout so a late GENERATED event can still settle. */
export const PROPOSAL_UI_TIMEOUT_MS = 195_000

/** Proposals never write task.yaml. Applying only changes the editor's unsaved draft. */
export function TaskProposal(props: {
  workspaceId: string; currentYaml?: string; draftIdentity: string; projectId?: string; model?: string;
  llmConnection?: string; disabled?: boolean; onApply: (spec: unknown) => void;
}) {
  const { t } = useTranslation()
  const [goal, setGoal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [proposal, setProposal] = React.useState<TaskGenerateResult | null>(null)
  const proposalBase = React.useRef<string | undefined>(undefined)
  const pending = React.useRef<PendingProposal | null>(null)
  const cancel = React.useCallback(() => {
    const request = pending.current
    if (!request) return
    request.cancelled = true
    request.off?.()
    clearTimeout(request.timer)
    if (request.sessionId) void window.electronAPI.deleteSession(request.sessionId).catch(() => {})
    pending.current = null
  }, [])
  React.useEffect(() => cancel, [cancel])

  async function generate() {
    if (pending.current || !goal.trim()) return
    setBusy(true)
    setError('')
    setProposal(null)
    proposalBase.current = props.draftIdentity
    const request: PendingProposal = { cancelled: false }
    pending.current = request
    // Subscribe before the RPC ack; a fast model may publish first.
    const early = new Map<string, TaskGenerateResult>()
    const receive = (result: TaskGenerateResult) => {
      if (request.cancelled) return
      request.off?.()
      clearTimeout(request.timer)
      pending.current = null
      setBusy(false)
      if (result.error || !result.validation.valid || !result.spec) {
        setError(result.error || result.validation.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
      } else setProposal(result)
    }
    request.off = window.electronAPI.onTaskGenerated((workspaceId, result) => {
      if (workspaceId !== props.workspaceId || request.cancelled) return
      if (!request.sessionId) early.set(result.orchestratorSessionId, result)
      else if (request.sessionId === result.orchestratorSessionId) receive(result)
    })
    request.timer = setTimeout(() => {
      cancel()
      setBusy(false)
      setError(t('tasks.proposalTimeout'))
    }, PROPOSAL_UI_TIMEOUT_MS)
    try {
      const ack = await window.electronAPI.generateTask(props.workspaceId, {
        goal, currentYaml: props.currentYaml, projectId: props.projectId,
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
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return <section className="space-y-2" aria-busy={busy}>
    <details open={!props.currentYaml}>
      <summary className="cursor-pointer text-sm font-medium">{t('tasks.proposalTitle')}</summary>
      <p className="py-2 text-xs text-muted-foreground">{t('tasks.proposalHint')}</p>
      <textarea aria-label={t('tasks.proposalGoal')} value={goal} onChange={e => setGoal(e.target.value)} disabled={busy}
        className="w-full rounded-md border bg-background p-2 text-sm" rows={3} maxLength={50000} />
      <Button onClick={() => void generate()} disabled={busy || props.disabled || !goal.trim()}>{t(busy ? 'tasks.proposalBusy' : 'tasks.proposalGenerate')}</Button>
      {busy && <Button variant="ghost" onClick={() => { cancel(); setBusy(false) }}>{t('common.cancel')}</Button>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{t('tasks.proposalFailed')} {error}</p>}
      {proposal && <div className="space-y-2 pt-2">
        <p role="status" className="text-sm">{t('tasks.proposalReview')}</p>
        <div className="flex h-80 min-h-0 flex-col"><ConductorWorkbench compact spec={proposal.spec as WorkbenchSpec} /></div>
        <details><summary>{t('tasks.proposalYamlPreview')}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{proposal.yaml}</pre></details>
        <Button disabled={props.disabled} onClick={() => {
          if (proposalBase.current !== props.draftIdentity) { setError(t('tasks.proposalStale')); return }
          props.onApply(proposal.spec); setProposal(null)
        }}>{t('tasks.proposalApply')}</Button>
        <Button variant="ghost" onClick={() => setProposal(null)}>{t('tasks.proposalReject')}</Button>
      </div>}
    </details>
  </section>
}
