import * as React from 'react'
import { useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowUp } from 'lucide-react'
import { HandoverPanel } from '@/components/app-shell/HandoverPanel'
import { extractSessionMeta, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { NAVIGATE_EVENT, routes, type NavigateEventDetail } from '@/lib/navigate'
import type { HandoverRecord, HandoverOperation, HandoverSnapshot } from '@craft-agent/shared/protocol'
import type { Session, SessionCommand } from '../../../shared/types'
import type { ComponentEntry } from './types'
import { mockElectronAPI } from '../mock-utils'

// Actual handover UI with fixed transport states; host/model acceptance is recorded separately.
function HandoverPreview({ state = 'ready' }: { state?: 'ready' | 'waiting' | 'unknown' | 'changed' | 'source-removed' }) {
  const setMetadata = useSetAtom(sessionMetaMapAtom)
  const setLoaded = useSetAtom(loadedSessionsAtom)
  const store = useStore()
  const { t } = useTranslation()
  const [records, setRecords] = React.useState<HandoverRecord[]>([])
  const [session, setSession] = React.useState<Session>()
  const completeWaiting = React.useRef<() => void>(() => {})
  // Install transport before HandoverPanel's passive effect loads its records.
  React.useLayoutEffect(() => {
    let stored: HandoverRecord[] = []
    const sessions = new Map<string, Session>()
    const makeSession = (id: string, workMode: 'NORM' | 'PRO'): Session => ({ id, workMode, executionRootSessionId: id,
      name: workMode === 'PRO' ? '成本核对' : '成本分析', workspaceId: 'preview', workspaceName: 'Playground',
      messages: [], lastMessageAt: Date.now(), isProcessing: false, permissionMode: 'safe', sessionFolderPath: `/preview/${id}` })
    sessions.set('norm-analysis', makeSession('norm-analysis', 'NORM'))
    const snapshot: HandoverSnapshot = {
      version: 1, source: { workspaceId: 'preview', sessionId: 'norm-analysis', messageId: 'answer', checkpoint: 'cp-f2' }, targetMode: 'PRO', capturedAt: 1,
      goal: ['比较 A/B 两年成本和风险'], acceptance: ['成本和风险各有依据，明确资料限制'], constraints: ['只读约定资料，不部署、不执行外部操作'], decisions: ['比较周期为两年'], scopeAndPriority: ['优先核对成本口径'],
      openQuestions: ['B 的运维成本口径待核对；风险资料存在缺口'], nextSteps: ['在 PRO 中核对成本口径并补齐风险资料'],
      claims: [{ ref: 'c1', text: 'A 两年成本 1000000 元', reviewStatus: 'unreviewed', sourceRefs: ['s1'] }],
      actions: state === 'unknown' ? [{ ref: 'op1', tool: 'external_publish', outcome: 'unknown', evidence: '连接中断，结果未知；请先核实远端是否发布成功。', sourceSessionId: 'norm-analysis' }] : [],
      files: [{ ref: 'file1', originalPath: '/资料/costs.txt', snapshotPath: 'files/example.txt', hash: '4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6', originalHash: '4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6', versionId: 'v1' }],
      originals: [{ id: 's1', sessionId: 'norm-analysis', role: 'user', text: '比较 A/B 两年成本和风险，只读资料，不部署。' }, { id: 's2', sessionId: 'norm-analysis', role: 'assistant', text: 'A 两年 1000000 元；B 口径未知，风险资料有缺口。' }], taskList: [], runs: [], warnings: [],
    }
    const apply = (record: HandoverRecord) => {
      const targetSessionId = `${record.targetMode.toLowerCase()}-${record.handoverId}`
      sessions.set(targetSessionId, makeSession(targetSessionId, record.targetMode))
      Object.assign(record, { status: 'applied', targetSessionId, snapshot: { ...snapshot, targetMode: record.targetMode, source: { ...snapshot.source, sessionId: record.sourceSessionId } } })
    }
    const create = (id: string, sourceSessionId: string, targetMode: 'NORM' | 'PRO'): HandoverRecord => {
      const record: HandoverRecord = { version: 1, handoverId: id, workspaceId: 'preview', sourceSessionId, targetMode, snapshotVersion: 1, createdAt: Date.now(), updatedAt: Date.now(), reviews: {}, status: 'waiting' }
      if (state !== 'waiting') apply(record)
      return record
    }
    if (['unknown','changed','source-removed'].includes(state)) stored = [create('preview-handover', 'norm-analysis', 'PRO')]
    setRecords(stored)
    setSession(sessions.get(state === 'unknown' ? stored[0]!.targetSessionId! : 'norm-analysis'))
    const metadata = new Map([...sessions].map(([id, value]) => [id, extractSessionMeta(value)]))
    if (state === 'source-removed') metadata.delete('norm-analysis')
    setMetadata(metadata)
    setLoaded(new Set())
    completeWaiting.current = () => {
      stored.filter(record => record.status === 'waiting').forEach(apply)
      setRecords([...stored])
      window.dispatchEvent(new Event('selection-handover-updated'))
    }
    const onNavigate = (event: Event) => {
      const route = (event as CustomEvent<NavigateEventDetail>).detail.route
      // Match the app's metadata prerequisite, including newly created targets.
      const target = [...sessions.values()].find(value => routes.view.allSessions(value.id) === route && store.get(sessionMetaMapAtom).has(value.id))
      if (target) setSession(target)
    }
    window.addEventListener(NAVIGATE_EVENT, onNavigate)
    Object.assign(window.electronAPI, {
      sessionCommand: async (sourceSessionId: string, command: SessionCommand) => {
        if (command.type !== 'handover') return
        const operation: HandoverOperation = command.operation
        if (operation.type === 'create' && !stored.some(record => record.handoverId === operation.handoverId)) stored = [create(operation.handoverId, sourceSessionId, operation.targetMode), ...stored]
        if (operation.type !== 'list') {
          const record = stored.find(record => record.handoverId === operation.handoverId)!
          if (operation.type === 'cancel') record.status = 'cancelled'
          if (operation.type === 'review') record.reviews[operation.actionRef] = { outcome: operation.outcome, note: operation.note }
        }
        setRecords([...stored])
        return { records: structuredClone(operation.type === 'list' ? stored : stored.filter(record => record.handoverId === operation.handoverId)), changes: [{ ref: 'file1', state: state === 'changed' ? 'changed' : 'unchanged' }] }
      },
      getSessionMessages: async (id: string) => sessions.get(id) ?? null,
    })
    return () => { window.removeEventListener(NAVIGATE_EVENT, onNavigate); Object.assign(window.electronAPI, mockElectronAPI) }
  }, [state, setMetadata, setLoaded, store])
  if (!session) return null
  const source = records.find(record => record.status === 'applied' && record.targetSessionId === session.id)
  const sourceLink = source ? { handoverId: source.handoverId, sourceSessionId: source.sourceSessionId } : undefined
  return <div data-handover-session={session.id} className="flex h-[520px] flex-col rounded-xl border border-border bg-background">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4"><span className="text-sm font-medium">{session.workMode} · {session.name}</span><HandoverPanel key={`header-${state}-${session.id}`} sessionId={session.id} mode={session.workMode!} canCreate headerOnly /></div>
    <div className="mt-4">{sourceLink && <HandoverPanel key={`banner-${state}-${session.id}`} sessionId={session.id} mode={session.workMode!} canCreate={false} sourceLink={sourceLink} />}</div>
    <motion.div key={session.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="flex min-h-0 flex-1 flex-col px-6 py-4 text-sm">
      <div className="space-y-3"><p>A 两年总成本为 1000000 元；B 的成本口径未知，风险资料存在缺口。</p><p className="text-muted-foreground">本次仅分析约定资料，不部署、不执行外部操作。</p></div>
      <div className="mt-auto rounded-xl border border-border p-3">
        <textarea key={session.id} aria-label="消息" placeholder={t('chatInput.placeholder.typeMessage')} className="min-h-16 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        <div className="flex justify-end"><button type="button" disabled aria-label={t('shortcuts.sendMessage')} className="rounded-full bg-foreground/10 p-1.5 text-muted-foreground"><ArrowUp className="size-4" /></button></div>
      </div>
    </motion.div>
    {state === 'waiting' && records.some(record => record.status === 'waiting') && <button type="button" className="mx-6 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => completeWaiting.current()}>完成源任务（预览）</button>}
    <span data-handover-record-count className="px-6 py-2 text-xs text-muted-foreground">交接记录：{records.length}</span>
  </div>
}
export const handoverComponents: ComponentEntry[] = [{ id: 'session-handover', name: '会话交接与来源', category: 'Session List', description: '真实交接面板，固定传输覆盖等待、来源变化和未知操作复核。', component: HandoverPreview, props: [{ name: 'state', control: { type: 'select', options: ['ready','waiting','unknown','changed','source-removed'].map(value => ({ label: value, value })) }, defaultValue: 'ready' }], layout: 'top' }]
