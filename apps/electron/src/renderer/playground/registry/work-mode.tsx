import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useSetAtom, useStore } from 'jotai'
import type { ComponentEntry } from './types'
import { TopBar } from '@/components/app-shell/TopBar'
import { BoardListToggle } from '@/components/app-shell/kanban/BoardListToggle'
import { ChildSessionPreviewDialog } from '@/components/app-shell/ChildSessionPreviewDialog'
import { SessionItem } from '@/components/app-shell/SessionItem'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import ChatPage from '@/pages/ChatPage'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { SessionListProvider } from '@/context/SessionListContext'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { FocusProvider } from '@/context/FocusContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { sessionWorkModeView } from '@/lib/work-mode-navigation'
import { cancelWorkModeTransition, transitionWorkMode } from '@/lib/work-mode-transition'
import { workModeViewAtom } from '@/atoms/work-mode'
import { sessionAtomFamily, sessionMetaMapAtom, loadedSessionsAtom, extractSessionMeta } from '@/atoms/sessions'
import { createMockContext } from './session-list'
import { mockElectronAPI } from '../mock-utils'
import type { FileAttachment, Session } from '../../../shared/types'
import type { SessionOptions } from '@/hooks/useSessionOptions'
import { defaultSessionOptions } from '@/hooks/useSessionOptions'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { withOrchestrationProgress } from '@/components/app-shell/kanban/orchestration-run-progress'
import { TurnCard, groupMessagesByTurn, withTaskMessagePresentation } from '@craft-agent/ui'

const previewWorkerInstructions = [
  '读取冻结的成本资料，核对两年总金额。标记尚未确认的口径和资料缺口。',
  '对照原文审查草稿中的金额与结论。指出错误和缺少依据的内容。',
  '独立核验草稿中的关键数字。保留尚未确认的口径与风险限制。',
  '根据审查意见修正报告中的金额。保留资料缺口，不作无依据的推荐。',
  '独立核验修订后的报告。确认问题已修正且资料限制完整保留。',
]

function SubagentProgressPreview({ status = 'running' }: { status?: 'running' | 'completed' | 'failed' }) {
  const base = useAppShellContext()
  const { t } = useTranslation()
  const store = useStore()
  const [previewId, setPreviewId] = React.useState<string | null>(null)
  const [previewContainer, setPreviewContainer] = React.useState<HTMLDivElement | null>(null)
  const startedAt = React.useRef(Date.now() - 30_000).current
  const run = React.useMemo((): TaskRunSnapshotDto => ({
    runId: 'preview-run', taskId: 'preview-task', slug: 'preview-task', status, tokensUsed: 0,
    nodes: ['读取原始资料', '审查报告草稿', '独立核验草稿', '修正报告', '核验修订结果'].map((title, index) => ({
      id: `node-${index}`, title, instruction: previewWorkerInstructions[index], attempt: 1,
      state: status === 'completed' || index < 3 ? 'done' : index === 3 ? (status === 'failed' ? 'failed' : 'running') : 'pending',
      sessionId: status === 'completed' || index < 4 ? `preview-worker-${index}` : undefined,
      ...(index === 0 ? { attempt: 2, attempts: [{ attempt: 1, sessionId: 'preview-worker-first', state: 'failed' }, { attempt: 2, sessionId: 'preview-worker-0', state: 'done' }] } : {}),
    })),
  }), [status])
  // Historical research assignments used a skills preamble and contained long host JSON.
  const legacyAssignment = `Apply these skills: [skill:deep-research]\n\nResearch role: researcher. Frozen research criteria and records (read necessary original source snapshot paths independently): ${JSON.stringify({
    line: { question: '核对方案成本与风险，保留尚未确认的资料限制', premises: ['金额以人民币元计，只分析两年期间'] },
    sources: [{ ref: '已冻结的成本原始资料', hash: '4c99133f'.repeat(8), snapshotPath: '/internal/research/source-0.txt' }],
    dimensions: [{ requirement: '方案 A 两年成本必须可定位原始资料' }, { requirement: '方案 B 的统计口径未确认时，不直接比较' }],
    claims: [{ id: 'cost', version: 2, text: '方案 A 两年成本为 100 万元' }],
  })}\nSubmit values.research using the native Skill contract.\nUser constraints for every node: ["只读资料，不修改文件或部署"]\nConfirmed plan decisions: ["submit_orchestration_patch depends_on=[review2,basis-review]"]\n\n`
  const reviewMessage = withTaskMessagePresentation({ id: 'preview-verification', role: 'user', timestamp: 3,
    content: 'The task "核对成本与风险" has finished running.\nTask slug: preview-task; runId: preview-run; revision: 4\nFrozen plan: {"nodes":[{"id":"cost"}]}\nNode outputs:\n{"claims":[{"id":"cost","version":2}]}\nCall submit_task_verdict with result pass or fail.',
  }, { taskSlug: run.slug })
  const reviewTurn = withOrchestrationProgress(groupMessagesByTurn([
    { id: 'preview-checkpoint', role: 'user', hidden: true, timestamp: 1, content: 'host checkpoint', taskContext: { kind: 'coordination', runId: run.runId } },
    { id: 'preview-next-step', role: 'assistant', timestamp: 2, content: '草稿审查已完成；等待修订报告，再核验修订结果。' },
    ...(status === 'completed' ? [reviewMessage,
      { id: 'preview-verdict', role: 'tool' as const, timestamp: 4, toolName: 'mcp__session__submit_task_verdict', toolStatus: 'completed' as const, toolInput: { runId: run.runId }, content: '', toolResult: '{"status":"completed"}' },
      { id: 'preview-report', role: 'assistant' as const, timestamp: 5, content: '报告已完成资料核对与草稿审查。方案 B 的统计口径尚未确认，暂时不能直接比较。' },
    ] : []),
  ], { isSessionProcessing: false, isTaskOrchestrationRoot: true, isTaskOrchestrationRunning: status === 'running' }), run, t)[0]
  const root = extractSessionMeta({ id: 'preview-root', name: '正式安装包聊天闭环验收', workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground', workMode: 'PRO', messages: [], lastMessageAt: Date.now(), isProcessing: status === 'running' })
  const sessions = React.useMemo(() => run.nodes.filter(node => node.sessionId).map(node => ({
    id: node.sessionId!, name: node.title, parentSessionId: 'preview-root', workMode: 'PRO', taskSlug: run.slug, taskNodeId: node.id,
    workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground',
    messages: [
      { id: `${node.id}-assignment`, role: 'user', content: legacyAssignment + previewWorkerInstructions[Number(node.id.slice(-1))], timestamp: startedAt,
        ...(node.id === 'node-1' ? { taskContext: { kind: 'assignment', instruction: previewWorkerInstructions[1], description: '核对方案成本与风险' } } : {}),
      },
      { id: `${node.id}-output`, role: 'assistant', content: `${node.title}。\n\n已核对方案 A 的金额为 **1,000,000 元**；方案 B 的统计口径尚未确认，暂时不能直接比较。\n\n此处使用固定预览数据，不调用模型。`, timestamp: startedAt + 1000 },
    ],
    lastMessageAt: startedAt + 1000, isProcessing: node.state === 'running', permissionMode: 'safe',
  } as Session)), [run, base.activeWorkspaceId, startedAt, legacyAssignment])
  React.useEffect(() => {
    const attempts = [...sessions, { ...sessions[0]!, id: 'preview-worker-first', name: '读取原始资料 · 第 1 次尝试', isProcessing: false,
      messages: [sessions[0]!.messages[0]!, { id: 'previous-output', role: 'assistant' as const, timestamp: startedAt,
        content: '第一次读取结果未通过复核，已由后续尝试取代。' }] }]
    store.set(sessionMetaMapAtom, new Map(attempts.map(session => [session.id, extractSessionMeta(session)])))
    store.set(loadedSessionsAtom, new Set(attempts.map(session => session.id)))
    for (const session of attempts) store.set(sessionAtomFamily(session.id), session)
  }, [store, sessions, startedAt])
  const context = createMockContext({ selectedSessionId: root.id, onSelectSessionById: () => {} })
  return <ActionRegistryProvider><FocusProvider><DismissibleLayerProvider><ModalProvider><NavigationProvider workspaceId={base.activeWorkspaceId} workspaceSlug="playground" onCreateSession={base.onCreateSession} isReady={false}><SessionListProvider value={context}>
    <div ref={setPreviewContainer} className="@container relative h-[560px] w-full overflow-hidden rounded-xl border border-border bg-background" data-subagent-preview
      style={{ '--accent': 'var(--pro-accent)', '--accent-rgb': 'var(--pro-accent-rgb)' } as React.CSSProperties}>
      <div className="flex h-full min-w-0">
        <aside className="hidden w-60 shrink-0 border-r border-border @min-[600px]:block">
          <PanelHeader title={t('sidebar.allSessions')} titleAlign="start" />
          <SessionItem item={root} index={0} itemProps={{ onKeyDown: () => {} }} isSelected isFirstInGroup isInMultiSelect={false} onSelect={() => {}} />
        </aside>
        <main className="min-w-0 flex-1 flex flex-col">
          <PanelHeader title={root.name} />
          <div className="min-h-0 flex-1 flex flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-6 text-sm leading-relaxed text-foreground">
              {reviewTurn?.type === 'assistant' && <TurnCard turnId={reviewTurn.turnId} activities={reviewTurn.activities} response={reviewTurn.response} intent={reviewTurn.intent} isStreaming={reviewTurn.isStreaming} isComplete={reviewTurn.isComplete}
                workControls={status === 'failed' ? <button type="button" className="m-2 rounded border border-border px-2 py-1 text-xs" onClick={() => {}}>{t('tasks.retryFailedNodes')}</button> : undefined}
                onOpenActivityDetails={activity => { if (activity.taskNode?.sessionId) setPreviewId(activity.taskNode.sessionId) }} />}
              <p className="mt-4 text-foreground/60">固定预览数据；展开子代理工作，点击任务查看对应内容。</p>
            </div>
          </div>
        </main>
      </div>
      <ChildSessionPreviewDialog sessionId={previewId} container={previewContainer} open={!!previewId} onOpenChange={open => { if (!open) setPreviewId(null) }} />
    </div>
  </SessionListProvider></NavigationProvider></ModalProvider></DismissibleLayerProvider></FocusProvider></ActionRegistryProvider>
}

// Real composer and rows with deterministic transport; never starts model work.
function WorkModePreview({ compactTopBar = false, compactInput = false }: { compactTopBar?: boolean; compactInput?: boolean }) {
  const { t } = useTranslation()
  const base = useAppShellContext()
  const [mode, setMode] = useAtom(workModeViewAtom)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [options, setOptions] = React.useState<Map<string, SessionOptions>>(new Map())
  const drafts = React.useRef(new Map<string, string>())
  const attachments = React.useRef(new Map<string, FileAttachment[]>())
  const setMetadata = useSetAtom(sessionMetaMapAtom)
  const setLoaded = useSetAtom(loadedSessionsAtom)
  const setPro = useSetAtom(sessionAtomFamily('pro-root'))
  const setWorker = useSetAtom(sessionAtomFamily('pro-worker'))
  const sessions = React.useMemo(() => [
    { id: 'pro-root', name: 'PRO · 成本核对', handover: { handoverId: 'legacy-preview', sourceSessionId: 'norm-source', snapshotVersion: 1 }, workMode: 'PRO', executionRootSessionId: 'pro-root', workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground', messages: [], lastMessageAt: Date.now(), isProcessing: false, permissionMode: 'safe' },
    { id: 'pro-worker', name: 'A 成本资料读取', workMode: 'PRO', executionRootSessionId: 'pro-root', parentSessionId: 'pro-root', taskNodeId: 'a', hidden: true, workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground', messages: [{ id: 'a', role: 'assistant', content: 'A 两年成本为 1000000 元，B 的成本口径仍待核实。[参考来源](https://example.com/costs)', timestamp: Date.now() }], lastMessageAt: Date.now(), isProcessing: false, hasUnread: true, permissionMode: 'safe' },
  ] as Session[], [base.activeWorkspaceId])
  React.useEffect(() => {
    setMetadata(new Map(sessions.map(session => [session.id, extractSessionMeta(session)])))
    setOptions(previous => new Map(previous).set('pro-root', { ...defaultSessionOptions, permissionMode: 'safe' }).set('pro-worker', { ...defaultSessionOptions, permissionMode: 'safe' }))
    setPro(sessions[0]!); setWorker(sessions[1]!); setLoaded(new Set(sessions.map(session => session.id)))
    Object.assign(window.electronAPI, {
      getWindowFocusState: async () => true,
      onWindowFocusChange: () => () => {},
      getDefaultThinkingLevel: async () => 'medium',
      getWorkspaceSettings: async () => ({ permissionMode: 'safe' }),
      getAdvancedSettings: async () => ({ dagOrchestrationEnabled: true, swarmAgentsEnabled: true, anySearchApiKeyConfigured: false }),
      getSessionMessages: async (id: string) => sessions.find(session => session.id === id),
    })
    return () => { Object.assign(window.electronAPI, mockElectronAPI) }
  }, [sessions, setMetadata, setPro, setWorker, setLoaded])
  const onSessionOptionsChange = React.useCallback((id: string, updates: Partial<SessionOptions>) => {
    setOptions(previous => new Map(previous).set(id, { ...defaultSessionOptions, ...previous.get(id), ...updates }))
  }, [])
  const context = { ...base, isCompactMode: compactInput, sessionOptions: options, onSessionOptionsChange,
    llmConnections: [{ slug: 'preview', name: '原有模型', providerType: 'pi', authType: 'api_key', defaultModel: 'original-model', isDefault: true, models: ['original-model'] }] as typeof base.llmConnections,
    getDraft: (id: string) => drafts.current.get(id) ?? '',
    onInputChange: (id: string, text: string) => { drafts.current.set(id, text) },
    hydrateDraftAttachments: async (id: string) => attachments.current.get(id) ?? [],
    onAttachmentsChange: (id: string, files: FileAttachment[]) => { attachments.current.set(id, files) },
  }
  const metadata = React.useMemo(() => new Map(sessions.map(session => [session.id, extractSessionMeta(session)])), [sessions])
  const selectedMode = sessionWorkModeView(selected ? metadata.get(selected) : undefined, metadata)
  React.useEffect(() => { if (selectedMode) setMode(selectedMode) }, [selected, selectedMode, setMode])
  const select = (id: string) => { setSelected(id) }
  const listContext = createMockContext({ selectedSessionId: selected, onSelectSessionById: select })
  const switchMode = (next: 'NORM' | 'PRO') => {
    if (next === mode) { cancelWorkModeTransition(); return }
    void transitionWorkMode(() => { setMode(next); setSelected(null) })
  }
  React.useEffect(() => () => cancelWorkModeTransition(), [])
  return <AppShellProvider value={context}><ActionRegistryProvider><FocusProvider><DismissibleLayerProvider><ModalProvider><NavigationProvider workspaceId={base.activeWorkspaceId} workspaceSlug="playground" onCreateSession={base.onCreateSession} isReady={false}><SessionListProvider value={listContext}>
    <div className="flex h-[600px] w-full min-w-0 flex-col rounded-xl border border-border bg-background" data-work-mode-preview>
      <div className="h-12 shrink-0 border-b border-border" style={{ transform: 'translateZ(0)', '--topbar-height': '48px', width: compactTopBar ? 375 : undefined } as React.CSSProperties} data-work-mode-topbar>
        <TopBar workspaces={base.workspaces} activeWorkspaceId={base.activeWorkspaceId} onSelectWorkspace={() => {}}
          onNewChat={() => setSelected(null)} onOpenSettings={() => {}} onOpenSettingsSubpage={() => {}}
          onOpenKeyboardShortcuts={() => {}} onOpenStoredUserPreferences={() => {}}
          onBack={() => {}} onForward={() => {}} canGoBack={false} canGoForward={false}
          onToggleSidebar={() => {}} onToggleFocusMode={() => {}} isCompact={compactTopBar}
          afterWorkspace={<BoardListToggle className={compactTopBar ? '[&_svg]:hidden' : undefined} value={mode} onChange={switchMode} />} />
      </div>
      <button type="button" className="self-end px-4 py-1 text-xs text-muted-foreground" onClick={() => select('pro-worker')}>打开 PRO 子会话深链接</button>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r border-border" data-work-mode-list data-work-mode-transition="list">
          <PanelHeader title={t('sidebar.allSessions')} titleAlign="start" />
          <button type="button" className="px-4 py-2 text-xs text-muted-foreground" onClick={() => setSelected(null)}>新建 {mode}</button>
          {mode === 'PRO' && <SessionItem item={extractSessionMeta(sessions[0]!)} index={0} itemProps={{ onKeyDown: () => {} }} isSelected={!!selected} isFirstInGroup isInMultiSelect={false} onSelect={() => select('pro-root')} />}
        </div>
        <div className="min-w-0 flex-1" data-work-mode-chat data-work-mode-transition="chat"><ChatPage sessionId={selected} /></div>
      </div>
    </div>
  </SessionListProvider></NavigationProvider></ModalProvider></DismissibleLayerProvider></FocusProvider></ActionRegistryProvider></AppShellProvider>
}
export const workModeComponents: ComponentEntry[] = [{
  id: 'subagent-progress', name: '子代理协作进度', category: 'Session List',
  description: '从折叠区点击子代理任务查看输出；固定预览数据，不调用模型。', component: SubagentProgressPreview,
  props: [{ name: 'status', control: { type: 'select', options: [{ label: '运行中', value: 'running' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }] }, defaultValue: 'running' }], layout: 'top',
}, {
  id: 'work-mode-navigation', name: 'NORM / PRO 导航与草稿', category: 'Session List',
  description: '实际模式切换、聊天草稿及执行子会话组件；传输使用固定数据。', component: WorkModePreview,
  props: [{ name: 'compactTopBar', control: { type: 'boolean' }, defaultValue: false }, { name: 'compactInput', control: { type: 'boolean' }, defaultValue: false }], layout: 'top',
}]
