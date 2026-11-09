import * as React from 'react'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskNodeRunStateDto, TaskResultNodeDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { effectiveNodeDeps } from '@craft-agent/shared/tasks/plan'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Markdown } from '@craft-agent/ui'
import type { WorkbenchNode } from './ConductorWorkbench'
import { currentTaskNodeResults } from './automatic-task-graph'
import { nodeKindLabelKey } from './task-labels'
import { resolveNodeStatePill } from './node-state-pill'
import { taskGraphStateColor } from './TaskFlowNode'
import { TaskNodeTabs } from './TaskNodeTabs'
import { formatUsageDuration } from '../session-usage-format'
import { taskResultMarkdown } from './task-result-markdown'

interface Props {
  node: WorkbenchNode
  nodes: WorkbenchNode[]
  instances: TaskNodeRunStateDto[]
  state?: string
  run?: TaskRunSnapshotDto | null
  workspaceId?: string
  overlay?: boolean
  onClose: () => void
  onSelect: (nodeId: string) => void
  onOpenSession?: (sessionId: string) => void
}

export function TaskNodeInspector({ node, nodes, instances, state, run, workspaceId, overlay, onClose, onSelect, onOpenSession }: Props) {
  const { t, i18n } = useTranslation()
  const backButton = React.useRef<HTMLButtonElement>(null)
  React.useLayoutEffect(() => {
    if (overlay) backButton.current?.focus()
  }, [overlay])
  const [tab, setTab] = React.useState('responsibility')
  const [retry, setRetry] = React.useState(0)
  const [loaded, setLoaded] = React.useState<{ key: string; nodes?: TaskResultNodeDto[]; error?: string }>()
  const key = JSON.stringify([workspaceId, run?.runId, run?.revision, node.id, instances.map(instance => [instance.id, instance.attempt, instance.state, instance.sessionId])])
  React.useEffect(() => {
    if (tab !== 'results' || !workspaceId || !run || !instances.some(instance => instance.attempt > 0)) return
    let cancelled = false
    void window.electronAPI.getTaskResults(workspaceId, run.slug, run.runId)
      .then(results => { if (!cancelled) setLoaded({ key, nodes: currentTaskNodeResults(results, run, instances) }) })
      .catch(error => { if (!cancelled) setLoaded({ key, error: String(error) }) })
    return () => { cancelled = true }
    // Re-read when the selected execution changes, never from an authored task definition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, key, retry])
  const results = loaded?.key === key ? loaded : undefined
  const instruction = instances.find(instance => instance.instruction)?.instruction ?? node.prompt
  const dependencyIds = effectiveNodeDeps(node, nodes)
  const expectedOutputs = node.outputs?.map(output => output.name).filter(Boolean)
  const pill = state ? resolveNodeStatePill(state) : undefined
  const blocked = instances.some(instance => instance.blocker === 'blocked-dependency')

  const hasExecution = instances.some(instance => instance.attempt > 0)
  const outputs = results?.nodes?.filter(result => result.output) ?? []
  const verdicts = instances.filter(instance => instance.verdict)
  const hasVerdict = verdicts.length > 0

  return <aside className="task-node-inspector flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-popover">
    <header className="shrink-0 px-5 pb-4 pt-3">
      <button ref={backButton} type="button" className="task-inspector-back" onClick={onClose}>
        <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />{t('tasks.graphBackToGraph')}
      </button>
      <div className="mt-3 min-w-0">
        <h3 className="task-inspector-title">{node.title ?? node.id}</h3>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t(nodeKindLabelKey(node.kind))}</span>
          {pill && state && <><span aria-hidden="true">·</span><span style={{ color: taskGraphStateColor(state) }}>{pill.labelKey ? t(pill.labelKey) : state}</span></>}
        </p>
      </div>
    </header>
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <TaskNodeTabs value={tab} label={node.title ?? node.id} />
      <TabsContent value="responsibility" className="task-inspector-content min-h-0 flex-1 overflow-auto px-5 pb-5 pt-6">
      <section className="task-inspector-section">
        <h4 className="task-inspector-label">{t('tasks.graphAssignment')}</h4>
        <p className="task-inspector-copy whitespace-pre-wrap break-words">{instruction || t('tasks.graphNoDescription')}</p>
        {blocked && <p className="task-inspector-copy mt-3">{t('tasks.graphBlockedDependency')}</p>}
      </section>
      {dependencyIds.length > 0 && <section className="task-inspector-section">
        <h4 className="task-inspector-label">{t('tasks.graphDependencies')}</h4>
        <div className="space-y-1">{dependencyIds.map(id => <button key={id} type="button" className="flex w-full items-center gap-2 rounded-md py-2 text-left text-[13px] text-[var(--pro-accent)] hover:underline focus-visible:outline focus-visible:outline-ring" onClick={() => onSelect(id)}><span className="min-w-0 flex-1 break-words">{nodes.find(dependency => dependency.id === id)?.title ?? id}</span><ArrowUpRight size={14} className="shrink-0" aria-hidden="true" /></button>)}</div>
      </section>}
      {expectedOutputs?.length ? <section className="task-inspector-section"><h4 className="task-inspector-label">{t('tasks.graphExpectedOutputs')}</h4><p className="task-inspector-copy break-words">{expectedOutputs.join(' · ')}</p></section> : null}
      </TabsContent>
      <TabsContent value="results" className="task-inspector-content min-h-0 flex-1 overflow-auto px-5 pb-5 pt-6">
      <section aria-label={t('tasks.graphResults')}>
        {blocked ? <p className="task-inspector-copy">{t('tasks.graphBlockedDependency')}</p>
          : !run || !workspaceId || !hasExecution ? !hasVerdict && <p className="task-inspector-copy text-muted-foreground">{t('tasks.graphNoResults')}</p>
          : results?.error ? <div role="alert" className="space-y-3 text-sm"><p>{t('tasks.graphResultsError')}</p><button type="button" className="text-[var(--pro-accent)] hover:underline focus-visible:outline focus-visible:outline-ring" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></div>
          : !results ? !hasVerdict && <p role="status" className="task-inspector-copy">{t('common.loading')}</p>
          : outputs.length ? <section className="task-inspector-section">
            <h4 className="task-inspector-label">{t('tasks.nodeOutputs')}</h4>
            <div className="space-y-5">{outputs.map(result => <section key={result.id}>
            {instances.length > 1 && <h5 className="task-inspector-item-title">{instances.find(instance => instance.id === result.id)?.title ?? result.title}</h5>}
            <div className="task-inspector-copy break-words [&_p]:text-[13px] [&_p]:leading-relaxed"><Markdown>{taskResultMarkdown(result.output!)}</Markdown></div>
          </section>)}</div></section> : !hasVerdict && <div className="space-y-2"><p className="task-inspector-copy text-muted-foreground">{t('tasks.graphNoResults')}</p>{state === 'done' && <button type="button" className="text-xs text-[var(--pro-accent)] hover:underline focus-visible:outline focus-visible:outline-ring" onClick={() => setRetry(value => value + 1)}>{t('common.refresh')}</button>}</div>}
        {verdicts.map(instance => <section key={instance.id} className="task-inspector-section">
          <div className="task-inspector-section-heading">
            <h4 className="task-inspector-label">{t('tasks.graphVerification')}</h4>
            <span className="text-xs font-medium" style={{ color: taskGraphStateColor(instance.verdict!.result === 'pass' ? 'done' : 'failed') }}>{t(instance.verdict!.result === 'pass' ? 'tasks.verdictPass' : 'tasks.verdictFail')}</span>
          </div>
          {instances.length > 1 && <h5 className="task-inspector-item-title">{instance.title ?? instance.id}</h5>}
          {instance.verdict?.reason && <div className="task-inspector-copy break-words [&_p]:text-[13px] [&_p]:leading-relaxed"><Markdown>{taskResultMarkdown(instance.verdict.reason)}</Markdown></div>}
          {instance.verdict?.evidence && <div className="mt-4"><h5 className="task-inspector-item-title">{t('tasks.evidenceSummary')}</h5><div className="task-inspector-copy break-words [&_p]:text-[13px] [&_p]:leading-relaxed"><Markdown>{taskResultMarkdown(instance.verdict.evidence)}</Markdown></div></div>}
        </section>)}
      </section>
      </TabsContent>
      <TabsContent value="runtime" className="task-inspector-content min-h-0 flex-1 overflow-auto px-5 pb-5 pt-6">
        {instances.length > 0 && <section className="task-inspector-section">
          <h4 className="task-inspector-label">{t('tasks.graphExecutionSummary')}</h4>
          {instances.map(instance => <div key={instance.id} className="task-inspector-execution">
          {instances.length > 1 && <h5 className="task-inspector-item-title">{instance.title ?? instance.id}</h5>}
          <dl className="task-inspector-fields">{[
            ['tasks.nodeModel', instance.model ?? node.model ?? '—'], ['tasks.nodeTokens', instance.tokensUsed ?? '—'],
            ['tasks.nodeAttempt', instance.attempt], ['tasks.nodeRetries', instance.retryCount ?? '—'],
            ['tasks.nodeElapsed', instance.elapsedMs === undefined ? '—' : instance.elapsedMs < 1000 ? `${instance.elapsedMs} ms` : formatUsageDuration(instance.elapsedMs)],
            ['tasks.nodeQueue', instance.queueMs === undefined ? '—' : `${instance.queueMs} ms`], ['tasks.nodeCache', instance.cacheStatus ?? '—'],
          ].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{typeof value === 'number' ? value.toLocaleString(i18n.language) : value}</dd></div>)}
          {instance.blocker && <div className="col-span-2"><dt>{t('tasks.nodeBlocker')}</dt><dd>{instance.blocker}</dd></div>}
          {instance.cacheSourceRunId && <div className="col-span-2"><dt>{t('tasks.cacheSource')}</dt><dd className="font-mono">{instance.cacheSourceRunId}</dd></div>}
          </dl>
          </div>)}
        </section>}
        <section className="task-inspector-section">
          <h4 className="task-inspector-label">{t('tasks.graphNodeInfo')}</h4>
          <dl className="task-inspector-fields">
            <div className="col-span-2"><dt>{t('tasks.graphNodeId')}</dt><dd className="font-mono">{node.id}</dd></div>
            {node.permissionMode && <div><dt>{t('tasks.nodePermission')}</dt><dd>{node.permissionMode}</dd></div>}
            {node.actor && <div><dt>{t('tasks.nodeActor')}</dt><dd>{node.actor.id}{node.actor.persona ? ` · ${node.actor.persona}` : ''}</dd></div>}
          </dl>
        </section>
        {instruction && <section className="task-inspector-section"><h4 className="task-inspector-label">{t('tasks.graphFullInstruction')}</h4><p className="task-inspector-copy whitespace-pre-wrap break-words">{instruction}</p></section>}
        {(node.loop != null || node.for_each || node.route || node.when != null) && <section className="task-inspector-section"><h4 className="task-inspector-label">{t('tasks.nodeControlFlow')}</h4><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ loop: node.loop, for_each: node.for_each, route: node.route, when: node.when }, null, 2)}</pre></section>}
      </TabsContent>
    </Tabs>
    {instances.some(instance => instance.sessionId) && onOpenSession && <footer className="shrink-0 border-t border-border px-5 py-3">{instances.filter(instance => instance.sessionId).map(instance => <button key={instance.id} type="button" className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-xs text-[var(--pro-accent)] hover:underline focus-visible:outline focus-visible:outline-ring" onClick={() => onOpenSession(instance.sessionId!)}><span>{t('tasks.openChildSession')}{instances.length > 1 ? ` · ${instance.title ?? instance.id}` : ''}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</footer>}
  </aside>
}
