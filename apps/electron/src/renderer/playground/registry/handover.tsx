import * as React from 'react'
import { useSetAtom } from 'jotai'
import { HandoverPanel } from '@/components/app-shell/HandoverPanel'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import type { HandoverRecord, HandoverOperation, HandoverSnapshot } from '@craft-agent/shared/protocol'
import type { SessionCommand } from '../../../shared/types'
import type { ComponentEntry } from './types'
import { mockElectronAPI } from '../mock-utils'

// Actual handover UI with fixed transport states; host/model acceptance is recorded separately.
function HandoverPreview({ state = 'ready' }: { state?: 'ready' | 'waiting' | 'unknown' | 'changed' | 'source-removed' }) {
  const setMetadata = useSetAtom(sessionMetaMapAtom)
  const [records, setRecords] = React.useState<HandoverRecord[]>([])
  const [target, setTarget] = React.useState(false)
  React.useEffect(() => {
    let stored: HandoverRecord[] = []
    const snapshot: HandoverSnapshot = {
      version: 1, source: { workspaceId: 'preview', sessionId: 'norm-analysis', messageId: 'answer', checkpoint: 'cp-f2' }, targetMode: 'PRO', capturedAt: 1,
      goal: ['比较 A/B 两年成本和风险'], acceptance: ['成本和风险各有依据，明确资料限制'], constraints: ['只读约定资料，不部署、不执行外部操作'], decisions: ['比较周期为两年'], scopeAndPriority: ['优先核对成本口径'],
      openQuestions: ['B 的运维成本口径待核对；风险资料存在缺口'], nextSteps: ['在 PRO 中核对成本口径并补齐风险资料'],
      claims: [{ ref: 'c1', text: 'A 两年成本 1000000 元', reviewStatus: 'unreviewed', sourceRefs: ['s1'] }],
      actions: state === 'unknown' ? [{ ref: 'op1', tool: 'external_publish', outcome: 'unknown', evidence: '连接中断，结果未知；请先核实远端是否发布成功。', sourceSessionId: 'norm-analysis' }] : [],
      files: [{ ref: 'file1', originalPath: '/资料/costs.txt', snapshotPath: 'files/example.txt', hash: '4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6', originalHash: '4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6', versionId: 'v1' }],
      originals: [{ id: 's1', sessionId: 'norm-analysis', role: 'user', text: '比较 A/B 两年成本和风险，只读资料，不部署。' }, { id: 's2', sessionId: 'norm-analysis', role: 'assistant', text: 'A 两年 1000000 元；B 口径未知，风险资料有缺口。' }], taskList: [], runs: [], warnings: [],
    }
    const create = (id: string): HandoverRecord => ({ version: 1, handoverId: id, workspaceId: 'preview', sourceSessionId: 'norm-analysis', targetMode: 'PRO', snapshotVersion: 1, createdAt: Date.now(), updatedAt: Date.now(), reviews: {}, status: state === 'waiting' ? 'waiting' : 'applied', ...(state === 'waiting' ? {} : { targetSessionId: 'pro-target', snapshot }) })
    if (['unknown','changed','source-removed'].includes(state)) stored = [create('preview-handover')]
    setRecords(stored); setTarget(state === 'unknown');
    const metadata = new Map<string, any>([['pro-target', { id: 'pro-target', workMode: 'PRO', executionRootSessionId: 'pro-target', name: '成本核对' }]])
    if (state !== 'source-removed') metadata.set('norm-analysis', { id: 'norm-analysis', workMode: 'NORM', executionRootSessionId: 'norm-analysis', name: '成本分析' })
    setMetadata(metadata)
    Object.assign(window.electronAPI, {
      sessionCommand: async (_id: string, command: SessionCommand) => {
        if (command.type !== 'handover') return
        const operation: HandoverOperation = command.operation
        if (operation.type === 'create' && !stored.some(record => record.handoverId === operation.handoverId)) stored = [create(operation.handoverId), ...stored]
        if (operation.type !== 'list') {
          const record = stored.find(record => record.handoverId === operation.handoverId)!
          if (operation.type === 'cancel') record.status = 'cancelled'
          if (operation.type === 'review') record.reviews[operation.actionRef] = { outcome: operation.outcome, note: operation.note }
        }
        setRecords([...stored])
        return { records: structuredClone(operation.type === 'list' ? stored : stored.filter(record => record.handoverId === operation.handoverId)), changes: [{ ref: 'file1', state: state === 'changed' ? 'changed' : 'unchanged' }] }
      },
      getSessionMessages: async () => ({ sessionFolderPath: '/preview/pro-target' }),
    })
    return () => { Object.assign(window.electronAPI, mockElectronAPI) }
  }, [state, setMetadata])
  const sourceLink = records[0]?.status === 'applied' ? { handoverId: records[0].handoverId, sourceSessionId: 'norm-analysis' } : undefined
  return <div className="flex h-[520px] flex-col rounded-xl border border-border bg-background">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4"><span className="text-sm font-medium">{target ? 'PRO · 成本核对' : 'NORM · 成本分析'}</span><HandoverPanel key={`header-${state}`} sessionId={target ? 'pro-target' : 'norm-analysis'} mode={target ? 'PRO' : 'NORM'} canCreate headerOnly /></div>
    <div className="mt-4">{target && sourceLink && <HandoverPanel key={`banner-${state}`} sessionId="pro-target" mode="PRO" canCreate={false} sourceLink={sourceLink} />}</div>
    <div className="space-y-3 px-6 py-4 text-sm"><p>A 两年总成本为 1000000 元；B 的成本口径未知，风险资料存在缺口。</p><p className="text-muted-foreground">本次仅分析约定资料，不部署、不执行外部操作。</p></div>
    {records[0]?.status === 'applied' && !target && <button type="button" className="mx-6 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setTarget(true)}>打开目标预览</button>}
    <span data-handover-record-count className="mt-auto p-4 text-xs text-muted-foreground">交接记录：{records.length}</span>
  </div>
}
export const handoverComponents: ComponentEntry[] = [{ id: 'session-handover', name: '会话交接与来源', category: 'Session List', description: '真实交接面板，固定传输覆盖等待、来源变化和未知操作复核。', component: HandoverPreview, props: [{ name: 'state', control: { type: 'select', options: ['ready','waiting','unknown','changed','source-removed'].map(value => ({ label: value, value })) }, defaultValue: 'ready' }], layout: 'top' }]
