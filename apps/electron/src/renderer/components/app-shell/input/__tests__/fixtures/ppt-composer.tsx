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
import { loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { workModeViewAtom } from '@/atoms/work-mode'
import { createDraftDisplaySession } from '@/lib/draft-session'
import { mockSources } from '@/playground/mock-utils'
import ChatPage from '@/pages/ChatPage'
import type { CreateSessionOptions, Session } from '../../../../../../shared/types'
import '@/index.css'

const store = createStore()
const calls = { creates: [] as CreateSessionOptions[], sends: [] as unknown[][], commands: [] as unknown[][] }
let pickedDirectory: string | null = '/work/ppt-input'
const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#1d3152"/><text x="80" y="240" fill="white" font-size="60">Strategy review</text><path d="M80 300H650" stroke="#ffb35c" stroke-width="8"/></svg>')}`
Object.assign(window.electronAPI, {
  openFolderDialog: async () => pickedDirectory,
  getTransportConnectionState: async () => ({ mode: 'local', status: 'connected' }),
  getPptCatalog: async () => ({ templates: [{ id: 'fixture-template', title: 'Strategy review', category: '商务', canvas: '16:9', pages: 12, cover, referencePages: [cover] }], themes: [] }),
  getPptLive: async () => null,
  getWorkspaceSettings: async () => ({}),
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
  const [id, setId] = React.useState<string | null>(null)
  const [ppt, setPpt] = React.useState(true)
  const [compact, setCompact] = React.useState(false)
  const [project, setProject] = React.useState<string>()
  const onCreateSession = React.useCallback(async (workspaceId: string, options: CreateSessionOptions = {}) => {
    calls.creates.push(structuredClone(options))
    const session = { ...createDraftDisplaySession({ ...options, workspaceId, id: `created-${calls.creates.length}` }),
      ...options, sessionFolderPath: `/sessions/created-${calls.creates.length}` } as Session
    store.set(sessionAtomFamily(session.id), session)
    store.set(loadedSessionsAtom, previous => new Set([...previous, session.id]))
    store.set(sessionMetaMapAtom, previous => new Map(previous).set(session.id, session))
    return session
  }, [])
  Object.assign(window, { pptFixture: {
    calls,
    configure: (options: { id?: string; ppt?: boolean; compact?: boolean; directory?: string | null; project?: string; mode?: 'NORM' | 'PRO' }) => {
      setId(options.id ?? null); setPpt(options.ppt ?? true); setCompact(options.compact ?? false); setProject(options.project)
      store.set(workModeViewAtom, options.mode ?? 'NORM')
      if ('directory' in options) pickedDirectory = options.directory ?? null
    },
    openCreated: () => setId(`created-${calls.creates.length}`),
  } })
  const value: typeof parent = { ...parent,
    isFocusedPanel: true, isCompactMode: compact, orchestrationProjectId: project,
    enabledSources: mockSources, skills: [], onCreateSession,
    llmConnections: [{ slug: 'fixture', name: 'Fixture', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key',
      isAuthenticated: true, createdAt: 0, defaultModel: 'gpt-4o', models: ['gpt-4o'] }],
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
  }
  return <AppShellProvider value={value}>
    <NavigationProvider workspaceId={parent.activeWorkspaceId} workspaceSlug="playground" onCreateSession={onCreateSession} isReady isSessionsReady>
      <div className="h-screen bg-background text-foreground"><ChatPage sessionId={id} pptMode={ppt} /></div>
    </NavigationProvider>
  </AppShellProvider>
}
store.set(projectsAtom, [{ config: { id: 'project', name: 'Project', workingDirectory: '/project/fixed' } }] as never)
createRoot(document.getElementById('root')!).render(<Provider store={store}><ThemeProvider><TooltipProvider><ActionRegistryProvider>
  <DismissibleLayerProvider><ModalProvider><EscapeInterruptProvider><FocusProvider><PlaygroundAppShellProvider>
    <Fixture />
  </PlaygroundAppShellProvider></FocusProvider></EscapeInterruptProvider></ModalProvider></DismissibleLayerProvider>
</ActionRegistryProvider></TooltipProvider></ThemeProvider></Provider>)
