// The real ChatPage and composer; only the host bridge is replaced.
import '@/playground/mock-utils'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import { TooltipProvider } from '@craft-agent/ui'
import { PlaygroundAppShellProvider } from '@/playground/PlaygroundAppShellProvider'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { loadedSessionsAtom, removeSessionAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { workModeViewAtom } from '@/atoms/work-mode'
import { createDraftDisplaySession } from '@/lib/draft-session'
import { mockSources } from '@/playground/mock-utils'
import ChatPage from '@/pages/ChatPage'
import { mergeSessionOptions, type SessionOptions } from '@/hooks/useSessionOptions'
import { AppShell } from '@/components/app-shell/AppShell'
import { ConfirmationHost } from '@/components/ConfirmationHost'
import { confirmClientDialog } from '@/lib/confirmation'
import { navigate, routes } from '@/lib/navigate'
import type { CreateSessionOptions, Session } from '../../../../../../shared/types'
import '@/index.css'

const drafts = new Map<string, string>()
const getDraft = (id: string) => drafts.get(id) ?? ''
const onInputChange = (id: string, text: string) => { drafts.set(id, text) }
const store = createStore()
const fullShell = new URLSearchParams(location.search).has('shell')
const fastFixture = new URLSearchParams(location.search).has('fast')
const fixtureModel = fastFixture ? 'gpt-6.1-sol' : 'gpt-4o'
const scrollFixture = new URLSearchParams(location.search).has('scroll')
const calls = { creates: [] as CreateSessionOptions[], sends: [] as unknown[][], commands: [] as unknown[][] }
let pickedDirectory: string | null = '/work/ppt-input'
const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#1d3152"/><text x="80" y="240" fill="white" font-size="60">Strategy review</text><path d="M80 300H650" stroke="#ffb35c" stroke-width="8"/></svg>')}`
Object.assign(window.electronAPI, {
  getSources: async () => mockSources,
  onSourcesChanged: () => () => {},
  getSkills: async () => [],
  onSkillsChanged: () => () => {},
  getProjects: async () => [{ config: { id: 'project', slug: 'redundant', name: 'Redundant', workingDirectory: '/project/fixed', createdAt: 0, updatedAt: 0 }, folderPath: '/project' }],
  onProjectsChanged: () => () => {},
  listStatuses: async () => [],
  onStatusesChanged: () => () => {},
  listLabels: async () => [],
  onLabelsChanged: () => () => {},
  listViews: async () => [],
  getAutomations: async () => '{}',
  getAutomationLastExecuted: async () => ({}),
  onAutomationsChanged: () => () => {},
  getUnreadSummary: async () => ({ hasUnreadByWorkspace: {} }),
  onUnreadSummaryChanged: () => () => {},
  openFolderDialog: async () => pickedDirectory,
  getTransportConnectionState: async () => ({ mode: 'local', status: 'connected' }),
  getPptCatalog: async () => ({ templates: [
    { id: 'fixture-template', title: 'Strategy review', category: '商务', canvas: '16:9', pages: 12, cover, referencePages: [cover] },
    ...(scrollFixture ? [{ id: 'scroll-template', title: 'Scrollable template', category: '自定义', canvas: '16:9', pages: 12, cover, referencePages: [cover] }] : []),
  ], themes: [] }),
  getPptTemplatePreview: async () => cover,
  getWorkspaceSettings: async () => ({}),
  getSessionMessages: async (id: string) => store.get(sessionAtomFamily(id)) ?? null,
  sessionCommand: async (id: string, command: { type: string; dir?: string }) => {
    calls.commands.push([id, command])
    if (command.type === 'updateWorkingDirectory') {
      store.set(sessionAtomFamily(id), session => session && ({ ...session, workingDirectory: command.dir }))
    }
  },
})
setupI18n([initReactI18next]).changeLanguage('zh-CN')

function Fixture() {
  const parent = useAppShellContext()
  const [sessionOptions, setSessionOptions] = React.useState(new Map<string, SessionOptions>())
  const [id, setId] = React.useState<string | null>(null)
  const [ppt, setPpt] = React.useState(!fullShell)
  const [compact, setCompact] = React.useState(false)
  const [project, setProject] = React.useState<string>()
  const onCreateSession = React.useCallback(async (workspaceId: string, options: CreateSessionOptions = {}) => {
    calls.creates.push(structuredClone(options))
    setSessionOptions(previous => new Map(previous).set(`created-${calls.creates.length}`, mergeSessionOptions(undefined, { fastMode: options.fastMode, thinkingLevel: options.thinkingLevel ?? 'medium' })))
    const session = { ...createDraftDisplaySession({ ...options, workspaceId, id: `created-${calls.creates.length}` }),
      ...options, sessionFolderPath: `/sessions/created-${calls.creates.length}` } as Session
    store.set(sessionAtomFamily(session.id), session)
    store.set(loadedSessionsAtom, previous => new Set([...previous, session.id]))
    store.set(sessionMetaMapAtom, previous => new Map(previous).set(session.id, session))
    return session
  }, [])
  Object.assign(window, { pptFixture: {
    calls, drafts,
    setModel: (sessionId: string, model: string) => store.set(sessionAtomFamily(sessionId), session => session && ({ ...session, model })),
    setProcessing: (sessionId: string, value: boolean) => store.set(sessionAtomFamily(sessionId), session => session && ({ ...session, isProcessing: value })),
    configure: (options: { id?: string; ppt?: boolean; compact?: boolean; directory?: string | null; project?: string; mode?: 'NORM' | 'PRO' }) => {
      setId(options.id ?? null); setPpt(options.ppt ?? true); setCompact(options.compact ?? false); setProject(options.project)
      store.set(workModeViewAtom, options.mode ?? 'NORM')
      if (fullShell) navigate(options.ppt ? routes.view.ppt() : routes.view.allSessions(options.id), { skipAutoSelect: !options.id })
      if ('directory' in options) pickedDirectory = options.directory ?? null
    },
    openCreated: () => setId(`created-${calls.creates.length}`),
    seedSession: async (mode: 'NORM' | 'PRO', count = 0) => {
      const session = await onCreateSession(parent.activeWorkspaceId!, { workMode: mode, model: fixtureModel, llmConnection: 'fixture' })
      if (count) store.set(sessionAtomFamily(session.id), { ...session, messages: Array.from({ length: count }, (_, i) => ({
        id: `scroll-${i}`, role: i % 2 ? 'assistant' as const : 'user' as const,
        content: `Message ${i + 1}\n\n${'Content remains scrollable inside the conversation. '.repeat(8)}`, timestamp: Date.now() + i,
      })) })
      return session
    },
    seedPptHistory: () => {
      const now = Date.now()
      const workspaceId = parent.activeWorkspaceId!
      const rows = [
        { id: 'ppt-generating', name: '为我按照word中的内容生成演示', lastMessageAt: now - 30_000, isProcessing: true, pptProgress: { total: 0, completed: 0, generating: true } },
        { id: 'ppt-ready', name: '为我按照word中的内容整理方案', lastMessageAt: now - 19 * 60_000, isProcessing: false, pptProgress: { total: 18, completed: 18, generating: false } },
        { id: 'ppt-plan', name: '制作PPT彩票计划', lastMessageAt: now - 3 * 60 * 60_000, isProcessing: false, pptProgress: { total: 12, completed: 12, generating: false } },
      ]
      const meta = new Map(store.get(sessionMetaMapAtom))
      const loaded = new Set(store.get(loadedSessionsAtom))
      for (const row of rows) {
        const session = {
          ...createDraftDisplaySession({ id: row.id, workspaceId, workMode: 'PRO', model: fixtureModel, llmConnection: 'fixture' }),
          name: row.name,
          preview: row.name,
          lastMessageAt: row.lastMessageAt,
          createdAt: row.lastMessageAt,
          isProcessing: row.isProcessing,
          lastFinalMessageId: `${row.id}-final`,
          ppt: { templateId: 'fixture-template' },
          pptProgress: row.pptProgress,
          messages: [{ id: `${row.id}-user`, role: 'user' as const, content: row.name, timestamp: row.lastMessageAt }],
        } satisfies Session
        store.set(sessionAtomFamily(session.id), session)
        meta.set(session.id, session)
        loaded.add(session.id)
      }
      store.set(sessionMetaMapAtom, meta)
      store.set(loadedSessionsAtom, loaded)
      if (fullShell) navigate(routes.view.ppt('ppt-ready'))
      return rows.map(row => row.id)
    },
  } })
  const value: typeof parent = { ...parent,
    getDraft, onInputChange,
    sessionOptions,
    onSessionOptionsChange: (sessionId, updates) => setSessionOptions(previous => new Map(previous).set(sessionId, mergeSessionOptions(previous.get(sessionId), updates))),
    isFocusedPanel: true, isCompactMode: compact, orchestrationProjectId: project,
    enabledSources: mockSources, skills: [], onCreateSession,
    llmConnections: [{ slug: 'fixture', name: 'Fixture', providerType: 'pi', piAuthProvider: fastFixture ? 'openai-codex' : 'openai', authType: fastFixture ? 'oauth' : 'api_key',
      isAuthenticated: true, createdAt: 0, defaultModel: fixtureModel, models: fastFixture ? ['gpt-6.1-sol', 'gpt-4o'] : ['gpt-4o'] }],
    workspaceDefaultLlmConnection: 'fixture',
    onSendMessage: async (...args: unknown[]) => {
      calls.sends.push(args)
      store.set(sessionAtomFamily(args[0] as string), session => session && ({ ...session, messages: [
        ...session.messages,
        { id: `user-${calls.sends.length}`, role: 'user', content: args[1] as string, timestamp: Date.now() },
        { id: `assistant-${calls.sends.length}`, role: 'assistant', content: '已收到 PPT 需求，可继续补充资料或调整内容。', timestamp: Date.now() },
      ] }))
      return true
    },
    onSessionSourcesChange: (sessionId: string, slugs: string[]) => {
      store.set(sessionAtomFamily(sessionId), session => session && ({ ...session, enabledSourceSlugs: slugs }))
    },
    onDeleteSession: async (sessionId: string) => {
      const meta = store.get(sessionMetaMapAtom).get(sessionId)
      const isEmpty = !meta || (!meta.lastFinalMessageId && !meta.name)
      if (!isEmpty) {
        const confirmed = (await confirmClientDialog({
          kind: 'deleteSession',
          name: meta?.name || 'Untitled',
          title: '',
          message: '',
          buttons: ['Cancel', 'Delete'],
          cancelId: 0,
        })).response === 1
        if (!confirmed) return false
      }
      store.set(removeSessionAtom, sessionId)
      return true
    },
  }
  return <AppShellProvider value={value}>
    <NavigationProvider workspaceId={parent.activeWorkspaceId} workspaceSlug="playground" onCreateSession={onCreateSession} isReady isSessionsReady>
      <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground" style={fullShell ? { paddingTop: 'var(--topbar-height)' } : undefined}>{fullShell ? <AppShell contextValue={value} /> : <ChatPage sessionId={id} pptMode={ppt} />}</div>
    </NavigationProvider>
  </AppShellProvider>
}
store.set(projectsAtom, [{ config: { id: 'project', name: 'Project', workingDirectory: '/project/fixed' } }] as never)
createRoot(document.getElementById('root')!).render(<Provider store={store}><ThemeProvider><TooltipProvider><ActionRegistryProvider>
  <DismissibleLayerProvider><ModalProvider><EscapeInterruptProvider><FocusProvider><PlaygroundAppShellProvider>
    <ConfirmationHost />
    <Fixture />
  </PlaygroundAppShellProvider></FocusProvider></EscapeInterruptProvider></ModalProvider></DismissibleLayerProvider>
</ActionRegistryProvider></TooltipProvider></ThemeProvider></Provider>)
