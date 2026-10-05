import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useSetAtom } from 'jotai'
import type { ComponentEntry } from './types'
import { TopBar } from '@/components/app-shell/TopBar'
import { BoardListToggle } from '@/components/app-shell/kanban/BoardListToggle'
import { ExecutionChildren } from '@/components/app-shell/ExecutionChildren'
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
import { OrchestrationRunProgressView } from '@/components/app-shell/kanban/OrchestrationRunProgress'
import { buildOrchestrationProgressRows } from '@/components/app-shell/kanban/orchestration-run-progress'

function SubagentProgressPreview({ status = 'running' }: { status?: 'running' | 'completed' | 'failed' }) {
  const base = useAppShellContext()
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState('preview-root')
  const titles = ['读取原始资料', '审查报告草稿', '独立核验草稿', '修正报告', '核验修订结果']
  const run: TaskRunSnapshotDto = {
    runId: 'preview-run', taskId: 'preview-task', slug: 'preview-task', status, tokensUsed: 0,
    nodes: titles.map((title, index) => ({
      id: `node-${index}`, title, attempt: 1,
      state: status === 'completed' || index < 3 ? 'done' : index === 3 ? (status === 'failed' ? 'failed' : 'running') : 'pending',
      sessionId: status === 'completed' || index < 4 ? `preview-worker-${index}` : undefined,
    })),
  }
  const root = extractSessionMeta({ id: 'preview-root', name: '正式安装包聊天闭环验收', workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground', workMode: 'PRO', messages: [], lastMessageAt: Date.now(), isProcessing: status === 'running' })
  const children = run.nodes.filter(node => node.sessionId).map(node => extractSessionMeta({
    id: node.sessionId!, name: node.title, parentSessionId: root.id, workMode: 'PRO',
    workspaceId: base.activeWorkspaceId!, workspaceName: 'Playground', messages: [], lastMessageAt: Date.now(),
    isProcessing: node.state === 'running', hasUnread: node.state === 'done',
  }))
  const context = createMockContext({ selectedSessionId: selected, onSelectSessionById: setSelected })
  return <ActionRegistryProvider><SessionListProvider value={context}>
    <div className="@container h-[480px] w-full overflow-hidden rounded-xl border border-border bg-background" data-subagent-preview
      style={{ '--accent': 'var(--pro-accent)', '--accent-rgb': 'var(--pro-accent-rgb)' } as React.CSSProperties}>
      <div className="flex h-full min-w-0">
        <aside className="hidden w-60 shrink-0 border-r border-border @min-[600px]:block">
          <PanelHeader title={t('sidebar.allSessions')} titleAlign="start" />
          <SessionItem item={root} index={0} itemProps={{ onKeyDown: () => {} }} isSelected isFirstInGroup isInMultiSelect={false} onSelect={() => setSelected(root.id)} />
          <ExecutionChildren children={children} selectedSessionId={selected} onSelect={setSelected} />
        </aside>
        <main className="min-w-0 flex-1">
          <PanelHeader title={selected === root.id ? root.name : children.find(child => child.id === selected)?.name} />
          {selected === root.id && <OrchestrationRunProgressView liveRun={run} rows={buildOrchestrationProgressRows(undefined, run)} onPreviewSession={setSelected}
            onRetry={status === 'failed' ? () => {} : undefined} />}
          <div className="p-6 text-sm leading-relaxed text-foreground">
            <p>{selected === root.id ? '报告已经完成资料核对与草稿审查，正在整合修订结果。' : children.find(child => child.id === selected)?.name}</p>
            <p className="mt-4 text-foreground/60">固定预览数据；点击进度展开详情，或从左侧查看子代理会话。</p>
          </div>
        </main>
      </div>
    </div>
  </SessionListProvider></ActionRegistryProvider>
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
          {mode === 'PRO' && <><SessionItem item={extractSessionMeta(sessions[0]!)} index={0} itemProps={{ onKeyDown: () => {} }} isSelected={!!selected} isFirstInGroup isInMultiSelect={false} onSelect={() => select('pro-root')} />
            <ExecutionChildren children={[extractSessionMeta(sessions[1]!)]} selectedSessionId={selected} onSelect={select} /></>}
        </div>
        <div className="min-w-0 flex-1" data-work-mode-chat data-work-mode-transition="chat"><ChatPage sessionId={selected} /></div>
      </div>
    </div>
  </SessionListProvider></NavigationProvider></ModalProvider></DismissibleLayerProvider></FocusProvider></ActionRegistryProvider></AppShellProvider>
}
export const workModeComponents: ComponentEntry[] = [{
  id: 'subagent-progress', name: '子代理协作进度', category: 'Session List',
  description: '实际子代理列表及运行进度组件；固定预览数据，不调用模型。', component: SubagentProgressPreview,
  props: [{ name: 'status', control: { type: 'select', options: [{ label: '运行中', value: 'running' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }] }, defaultValue: 'running' }], layout: 'top',
}, {
  id: 'work-mode-navigation', name: 'NORM / PRO 导航与草稿', category: 'Session List',
  description: '实际模式切换、聊天草稿及执行子会话组件；传输使用固定数据。', component: WorkModePreview,
  props: [{ name: 'compactTopBar', control: { type: 'boolean' }, defaultValue: false }, { name: 'compactInput', control: { type: 'boolean' }, defaultValue: false }], layout: 'top',
}]
