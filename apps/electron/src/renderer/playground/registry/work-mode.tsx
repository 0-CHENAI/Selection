import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useSetAtom } from 'jotai'
import type { ComponentEntry } from './types'
import { TopBar } from '@/components/app-shell/TopBar'
import { BoardListToggle } from '@/components/app-shell/kanban/BoardListToggle'
import { ExecutionChildren } from '@/components/app-shell/ExecutionChildren'
import { SessionItem } from '@/components/app-shell/SessionItem'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SessionModeBadge } from '@/components/app-shell/SessionModeBadge'
import ChatPage from '@/pages/ChatPage'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { SessionListProvider } from '@/context/SessionListContext'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { ModalProvider } from '@/context/ModalContext'
import { FocusProvider } from '@/context/FocusContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { sessionWorkModeView } from '@/lib/work-mode-navigation'
import { workModeViewAtom } from '@/atoms/work-mode'
import { sessionAtomFamily, sessionMetaMapAtom, loadedSessionsAtom, extractSessionMeta } from '@/atoms/sessions'
import { createMockContext } from './session-list'
import { mockElectronAPI } from '../mock-utils'
import type { FileAttachment, Session } from '../../../shared/types'
import type { SessionOptions } from '@/hooks/useSessionOptions'
import { defaultSessionOptions } from '@/hooks/useSessionOptions'

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
  return <AppShellProvider value={context}><ActionRegistryProvider><FocusProvider><ModalProvider><NavigationProvider workspaceId={base.activeWorkspaceId} workspaceSlug="playground" onCreateSession={base.onCreateSession} isReady={false}><SessionListProvider value={listContext}>
    <div className="flex h-[600px] w-full min-w-0 flex-col rounded-xl border border-border bg-background" data-work-mode-preview>
      <div className="h-12 shrink-0 border-b border-border" style={{ transform: 'translateZ(0)', '--topbar-height': '48px', width: compactTopBar ? 375 : undefined } as React.CSSProperties} data-work-mode-topbar>
        <TopBar workspaces={base.workspaces} activeWorkspaceId={base.activeWorkspaceId} onSelectWorkspace={() => {}}
          onNewChat={() => setSelected(null)} onOpenSettings={() => {}} onOpenSettingsSubpage={() => {}}
          onOpenKeyboardShortcuts={() => {}} onOpenStoredUserPreferences={() => {}}
          onBack={() => {}} onForward={() => {}} canGoBack={false} canGoForward={false}
          onToggleSidebar={() => {}} onToggleFocusMode={() => {}} isCompact={compactTopBar}
          afterWorkspace={<BoardListToggle className={compactTopBar ? '[&_svg]:hidden' : undefined} value={mode} onChange={next => { setMode(next); setSelected(null) }} />} />
      </div>
      <button type="button" className="self-end px-4 py-1 text-xs text-muted-foreground" onClick={() => select('pro-worker')}>打开 PRO 子会话深链接</button>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r border-border" data-work-mode-list>
          <PanelHeader title={t('sidebar.allSessions')} titleAlign="start" badge={<SessionModeBadge mode={mode} />} />
          <button type="button" className="px-4 py-2 text-xs text-muted-foreground" onClick={() => setSelected(null)}>新建 {mode}</button>
          {mode === 'PRO' && <><SessionItem item={extractSessionMeta(sessions[0]!)} index={0} itemProps={{ onKeyDown: () => {} }} isSelected={!!selected} isFirstInGroup isInMultiSelect={false} onSelect={() => select('pro-root')} />
            <ExecutionChildren children={[extractSessionMeta(sessions[1]!)]} selectedSessionId={selected} onSelect={select} /></>}
        </div>
        <div className="min-w-0 flex-1" data-work-mode-chat><ChatPage sessionId={selected} /></div>
      </div>
    </div>
  </SessionListProvider></NavigationProvider></ModalProvider></FocusProvider></ActionRegistryProvider></AppShellProvider>
}
export const workModeComponents: ComponentEntry[] = [{
  id: 'work-mode-navigation', name: 'NORM / PRO 导航与草稿', category: 'Session List',
  description: '实际模式切换、聊天草稿及执行子会话组件；传输使用固定数据。', component: WorkModePreview,
  props: [{ name: 'compactTopBar', control: { type: 'boolean' }, defaultValue: false }, { name: 'compactInput', control: { type: 'boolean' }, defaultValue: false }], layout: 'top',
}]
