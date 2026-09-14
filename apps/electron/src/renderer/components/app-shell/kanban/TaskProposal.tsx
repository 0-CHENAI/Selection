import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import type { TaskGenerateResult } from '@craft-agent/shared/protocol'
import type { ThoughtDocument, WorkbenchProposal, WorkbenchProposalBaseline } from '@craft-agent/shared/thought-workbench/types'
import { diffWorkbenchDefinitions, type WorkbenchFieldChange } from '@craft-agent/shared/thought-workbench/diff'
import { parse as parseYaml } from 'yaml'
type PendingProposal = { sessionId?: string; proposalId?: string; documentId?: string; cancelled: boolean; off?: () => void; timer?: ReturnType<typeof setTimeout> }

/** Slightly above the server generate timeout so a late GENERATED event can still settle. */
export const PROPOSAL_UI_TIMEOUT_MS = 195_000

/** Proposals never write task.yaml. Applying only changes the editor's unsaved draft. */
export function TaskProposal(props: {
  workspaceId: string; currentYaml?: string; draftIdentity: string; projectId?: string; model?: string;
  llmConnection?: string; disabled?: boolean; onApply: (spec: unknown) => void;
  context?: string;
  workbenchId?: string;
  prepareWorkbench?: (yaml: string) => Promise<WorkbenchProposalBaseline>;
  assertWorkbenchCurrent?: (baseline: WorkbenchProposalBaseline) => void;
  onWorkbenchApplied?: (document: ThoughtDocument) => void;
}) {
  const { t } = useTranslation()
  const [goal, setGoal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [proposal, setProposal] = React.useState<TaskGenerateResult | null>(null)
  const [history, setHistory] = React.useState<WorkbenchProposal[]>([])
  const [selectedRecord, setSelectedRecord] = React.useState<WorkbenchProposal | null>(null)
  const [changes, setChanges] = React.useState<WorkbenchFieldChange[]>([])
  const requestEpoch = React.useRef(0)
  const currentDraftIdentity = React.useRef(props.draftIdentity)
  currentDraftIdentity.current = props.draftIdentity
  const scope = React.useRef('')
  scope.current = JSON.stringify([props.workspaceId, props.workbenchId])
  const refreshHistory = React.useCallback(async () => {
    if (!props.workbenchId) return
    const expectedScope = JSON.stringify([props.workspaceId, props.workbenchId])
    const result = await window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'proposals', id: props.workbenchId })
    if (scope.current === expectedScope) setHistory(result.proposals ?? [])
  }, [props.workspaceId, props.workbenchId])
  React.useEffect(() => { void refreshHistory().catch(error => setError(String(error))) }, [refreshHistory])
  const proposalBase = React.useRef<string | undefined>(undefined)
  const pending = React.useRef<PendingProposal | null>(null)
  const cancel = React.useCallback(() => {
    const request = pending.current
    if (!request) return
    request.cancelled = true
    requestEpoch.current++
    request.off?.()
    clearTimeout(request.timer)
    if (request.sessionId) void window.electronAPI.deleteSession(request.sessionId).catch(() => {})
    if (request.documentId && request.proposalId) void window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'discardProposal', id: request.documentId, proposalId: request.proposalId }).catch(error => setError(String(error)))
    pending.current = null
  }, [props.workspaceId])
  React.useEffect(() => cancel, [cancel])

  async function generate() {
    if (pending.current || !goal.trim()) return
    setBusy(true)
    setError('')
    setProposal(null)
    setSelectedRecord(null); setChanges([])
    proposalBase.current = props.draftIdentity
    const request: PendingProposal = { cancelled: false }
    const epoch = ++requestEpoch.current
    pending.current = request
    // Subscribe before the RPC ack; a fast model may publish first.
    const early = new Map<string, TaskGenerateResult>()
    const receive = (result: TaskGenerateResult) => {
      if (request.cancelled || requestEpoch.current !== epoch) return
      request.off?.()
      clearTimeout(request.timer)
      pending.current = null
      setBusy(false)
      if (result.error || !result.validation.valid || !result.spec) {
        setError(result.error || result.validation.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
      } else {
        setProposal(result)
        try { setChanges(diffWorkbenchDefinitions(parseYaml(props.currentYaml ?? '{}'), result.spec)) } catch { setChanges([]) }
      }
      void refreshHistory().catch(error => setError(String(error)))
      if (request.documentId && result.workbenchProposalId) {
        void window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'proposals', id: request.documentId }).then(response => {
          if (requestEpoch.current === epoch) setSelectedRecord(response.proposals?.find(item => item.id === result.workbenchProposalId) ?? null)
        }).catch(error => setError(String(error)))
      }
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
      const baseline = await props.prepareWorkbench?.(props.currentYaml ?? '')
      if (request.cancelled) return
      request.documentId = baseline?.documentId
      const ack = await window.electronAPI.generateTask(props.workspaceId, {
        goal: !baseline && props.context ? `${goal}\n\n[Selected workbench context]\n${props.context}` : goal, currentYaml: props.currentYaml, projectId: props.projectId,
        workbench: baseline,
        model: props.model, llmConnection: props.llmConnection,
      })
      request.sessionId = ack.orchestratorSessionId
      request.proposalId = ack.workbenchProposalId
      if (request.cancelled) {
        void window.electronAPI.deleteSession(ack.orchestratorSessionId).catch(() => {})
        if (baseline && ack.workbenchProposalId) void window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'discardProposal', id: baseline.documentId, proposalId: ack.workbenchProposalId }).catch(() => {})
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

  async function inspect(record: WorkbenchProposal) {
    if (!record.yaml) return
    setError(''); setBusy(true)
    const epoch = ++requestEpoch.current
    try {
      const validation = await window.electronAPI.validateTask(props.workspaceId, record.yaml)
      if (requestEpoch.current !== epoch) return
      if (!validation.valid || !validation.spec) throw new Error(t('tasks.invalidNodeConfig'))
      setProposal({ orchestratorSessionId: record.sessionId ?? '', workbenchProposalId: record.id, slug: '', spec: validation.spec, yaml: record.yaml, validation })
      setSelectedRecord(record)
      proposalBase.current = (props.currentYaml ?? '') === record.currentYaml ? props.draftIdentity : undefined
      setChanges(diffWorkbenchDefinitions(parseYaml(record.currentYaml || '{}'), validation.spec))
    } catch (error) { setError(String(error)) } finally { setBusy(false) }
  }

  async function apply() {
    if (!proposal) return
    if (proposalBase.current !== props.draftIdentity) { setError(t('tasks.proposalStale')); return }
    setBusy(true)
    try {
      if (props.workbenchId) {
        if (!selectedRecord) throw new Error(t('tasks.proposalStale'))
        props.assertWorkbenchCurrent?.(selectedRecord.baseline)
        const result = await window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'applyProposal', id: props.workbenchId, proposalId: selectedRecord.id })
        if (!result.document) throw new Error(t('tasks.proposalStale'))
        if (proposalBase.current !== currentDraftIdentity.current) throw new Error(t('tasks.proposalStale'))
        props.onWorkbenchApplied?.(result.document)
      }
      props.onApply(proposal.spec); setProposal(null); setSelectedRecord(null)
      await refreshHistory()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  async function discard() {
    setBusy(true)
    try {
      if (props.workbenchId && selectedRecord) await window.electronAPI.thoughtWorkbench(props.workspaceId, { action: 'discardProposal', id: props.workbenchId, proposalId: selectedRecord.id })
      setProposal(null); setSelectedRecord(null); await refreshHistory()
    } catch (error) { setError(String(error)) } finally { setBusy(false) }
  }

  return <section className="space-y-2" aria-busy={busy}>
    <details open={!props.currentYaml || Boolean(props.context)}>
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
        <details open><summary className="text-sm">{t('thought.proposalDiff')}</summary><dl className="max-h-64 space-y-3 overflow-auto py-2 text-xs">{changes.map(change => <div key={change.path}>
          <dt className="break-all font-mono font-medium">{change.path}</dt>
          <dd className="grid gap-1 sm:grid-cols-2"><pre className="whitespace-pre-wrap break-words">− {JSON.stringify(change.before, null, 2) ?? '∅'}</pre><pre className="whitespace-pre-wrap break-words">+ {JSON.stringify(change.after, null, 2) ?? '∅'}</pre></dd>
        </div>)}</dl></details>
        <Button disabled={busy || props.disabled || (!!props.workbenchId && selectedRecord?.status !== 'ready')} onClick={() => void apply()}>{t('tasks.proposalApply')}</Button>
        <Button variant="ghost" disabled={busy || selectedRecord?.status === 'applied'} onClick={() => void discard()}>{t('tasks.proposalReject')}</Button>
      </div>}
      {!!history.length && <details><summary className="py-2 text-sm">{t('thought.proposalHistory')}</summary><ol className="max-h-64 space-y-3 overflow-auto text-sm">{history.map(record => <li key={record.id}>
        <p className="whitespace-pre-wrap break-words">{record.goal}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><time>{record.createdAt}</time><span>{t(`thought.proposalStatus.${record.status}`)}</span>
          {record.yaml && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void inspect(record)}>{t('thought.proposalDiff')}</Button>}
        </div>{record.error && <p className="text-xs text-destructive">{record.error}</p>}
      </li>)}</ol></details>}
    </details>
  </section>
}
