import { PanelResizeHandle } from '@/components/app-shell/PanelResizeHandle'
import { ResponseSourcesLayout } from '@craft-agent/ui/chat'
/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, FolderOpen, X } from 'lucide-react'
import { ChatDisplay, type ChatDisplayHandle } from '@/components/app-shell/ChatDisplay'
import { OrchestrationRunProgress } from '@/components/app-shell/kanban/OrchestrationRunProgress'
import { canPreviewOrchestrationChild } from '@/components/app-shell/kanban/orchestration-run-progress'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SessionMenu } from '@/components/app-shell/SessionMenu'
import { CompactSessionMenu } from '@/components/app-shell/CompactSessionMenu'
import { SessionInfoPopover } from '@/components/app-shell/SessionInfoPopover'
import { ChildSessionPreviewDialog } from '@/components/app-shell/ChildSessionPreviewDialog'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { toast } from 'sonner'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { TaskOrchestrationEditButton } from '@/components/ui/TaskOrchestrationEditButton'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { generatedFileBaseDir, resolveOpenableGeneratedFile } from '@/lib/generated-file-path'
import { resolveMarkdownLinkTarget } from '@craft-agent/ui'
import { navigate, routes } from '@/lib/navigate'
import { createDraftDisplaySession, createDraftSubmission, resolveDraftWorkingDirectory, DRAFT_SESSION_OPTIONS_ID } from '@/lib/draft-session'
import { coerceInputText } from '@/lib/input-text'
import type { Session } from '../../shared/types'
import { deriveSessionMessagesLoadState, formatSessionLoadFailure } from '@/lib/session-load'
import {
  ensureSessionMessagesLoadedAtom,
  forceSessionMessagesReloadAtom,
  loadedSessionsAtom,
  sessionMetaMapAtom,
  updateSessionAtom,
  updateSessionMetaAtom,
} from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { defaultSessionOptions } from '@/hooks/useSessionOptions'
import { getSessionTitle } from '@/utils/session'
// Model resolution: connection.defaultModel (no hardcoded defaults)
import { resolveEffectiveConnectionSlug, isSessionConnectionUnavailable } from '@config/llm-connections'

function SourcesResizeHandle(props: React.HTMLAttributes<HTMLDivElement>) {
  return <PanelResizeHandle {...props} standalone />
}

export interface ChatPageProps {
  sessionId: string | null
}

const ChatPage = React.memo(function ChatPage({ sessionId }: ChatPageProps) {
  const { t } = useTranslation()
  const isDraft = sessionId == null
  const optionsSessionId = sessionId ?? DRAFT_SESSION_OPTIONS_ID
  // Diagnostic: mark when component runs
  React.useLayoutEffect(() => {
    if (sessionId) rendererPerf.markSessionSwitch(sessionId, 'panel.mounted')
  }, [sessionId])

  const {
    activeWorkspaceId,
    orchestrationProjectId,
    llmConnections,
    workspaceDefaultLlmConnection,
    onCreateSession,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    workspaces,
    onRespondToPermission,
    onRespondToCredential,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSetActiveViewingSession,
    getDraft,
    hydrateDraftAttachments,
    onInputChange,
    onAttachmentsChange,
    enabledSources,
    skills,
    enabledModes,
    onSessionSourcesChange,
    onRenameSession,
    onDeleteSession,
    rightSidebarButton,
    leadingAction,
    isCompactMode,
    sessionListSearchQuery,
    isSearchModeActive,
    chatDisplayRef,
    onChatMatchInfoChange,
    isFocusedPanel,
  } = useAppShellContext()

  // Use the unified session options hook for clean access
  const {
    options: sessionOpts,
    setOption,
    setPermissionMode,
  } = useSessionOptionsFor(optionsSessionId)

  // Use per-session atom for isolated updates
  const session = useSessionData(optionsSessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = sessionId ? loadedSessions.has(sessionId) : true

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined

  // Fallback: ensure messages are loaded when session is viewed
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const forceMessagesReload = useSetAtom(forceSessionMessagesReloadAtom)
  const updateSession = useSetAtom(updateSessionAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const [messagesLoadError, setMessagesLoadError] = React.useState<string | null>(null)
  const [messagesRetrying, setMessagesRetrying] = React.useState(false)
  const [previewChildSessionId, setPreviewChildSessionId] = React.useState<string | null>(null)
  React.useEffect(() => {
    setPreviewChildSessionId(null)
  }, [sessionId])
  const autoForcedReloadSessionRef = React.useRef<string | null>(null)
  const shouldForceInitialMessagesReload = React.useMemo(() => {
    const expectedMessageCount = session?.messageCount ?? sessionMeta?.messageCount ?? 0
    return messagesLoaded
      && !!session
      && (session.messages?.length ?? 0) === 0
      && (expectedMessageCount > 0 || !!session.lastFinalMessageId || !!sessionMeta?.lastFinalMessageId)
  }, [messagesLoaded, session, sessionMeta])

  React.useEffect(() => {
    let cancelled = false
    setMessagesLoadError(null)
    setMessagesRetrying(false)

    if (!sessionId) {
      return () => {
        cancelled = true
      }
    }

    if (shouldForceInitialMessagesReload && autoForcedReloadSessionRef.current === sessionId) {
      setMessagesLoadError('Session messages are not available')
      return () => {
        cancelled = true
      }
    }

    const useForceReload = shouldForceInitialMessagesReload
    if (useForceReload) {
      autoForcedReloadSessionRef.current = sessionId
    }

    const loadPromise = useForceReload
      ? forceMessagesReload(sessionId)
      : ensureMessagesLoaded(sessionId)

    loadPromise
      .then((loadedSession) => {
        if (!cancelled && !loadedSession) {
          setMessagesLoadError('Session messages are not available')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessagesLoadError(formatSessionLoadFailure(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, ensureMessagesLoaded, forceMessagesReload, shouldForceInitialMessagesReload])

  const handleRetryMessagesLoad = React.useCallback(async () => {
    if (!sessionId) return
    setMessagesLoadError(null)
    setMessagesRetrying(true)

    try {
      const loadedSession = await forceMessagesReload(sessionId)
      if (!loadedSession) {
        setMessagesLoadError('Session messages are not available')
      }
    } catch (error) {
      setMessagesLoadError(formatSessionLoadFailure(error))
    } finally {
      setMessagesRetrying(false)
    }
  }, [forceMessagesReload, sessionId])

  const messageLoadState = React.useMemo(() => deriveSessionMessagesLoadState({
    session,
    sessionMeta,
    messagesLoaded,
    loadError: messagesLoadError,
  }), [session, sessionMeta, messagesLoaded, messagesLoadError])

  // Perf: Mark when session data is available
  const sessionLoadedMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (sessionId && session && sessionLoadedMarkedRef.current !== sessionId) {
      sessionLoadedMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
    }
  }, [sessionId, session])

  // Track window focus state for marking session as read when app regains focus
  const [isWindowFocused, setIsWindowFocused] = React.useState(true)
  React.useEffect(() => {
    window.electronAPI.getWindowFocusState().then(setIsWindowFocused)
    const cleanup = window.electronAPI.onWindowFocusChange(setIsWindowFocused)
    return cleanup
  }, [])

  // Track which session user is viewing (for unread state machine).
  // This tells main process user is looking at this session, so:
  // 1. If not processing → clear hasUnread immediately
  // 2. If processing → when it completes, main process will clear hasUnread
  // The main process handles all the logic; we just report viewing state.
  React.useEffect(() => {
    if (sessionId && session && isWindowFocused && isFocusedPanel !== false) {
      onSetActiveViewingSession(session.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isWindowFocused, isFocusedPanel, onSetActiveViewingSession])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(optionsSessionId)
  const pendingCredential = usePendingCredential(optionsSessionId)

  const initialDraftConnection = llmConnections.find(c => c.slug === workspaceDefaultLlmConnection)
    ?? llmConnections.find(c => c.isDefault) ?? llmConnections[0]
  const [draftModel, setDraftModel] = React.useState(initialDraftConnection?.defaultModel ?? '')
  const [draftConnection, setDraftConnection] = React.useState(initialDraftConnection?.slug)
  const projects = useAtomValue(projectsAtom)
  const [draftWorkingDirectoryOverride, setDraftWorkingDirectory] = React.useState<string | undefined>(undefined)
  const [workspaceWorkingDirectory, setWorkspaceWorkingDirectory] = React.useState<string | undefined>(undefined)
  const draftWorkingDirectory = resolveDraftWorkingDirectory(
    draftWorkingDirectoryOverride,
    projects.find(project => project.config.id === orchestrationProjectId)?.config.workingDirectory,
    workspaceWorkingDirectory,
  )
  const [draftSwarmEnabled, setDraftSwarmEnabled] = React.useState(false)
  const [draftSourceSlugs, setDraftSourceSlugs] = React.useState<string[]>(
    () => enabledSources?.map(source => source.config.slug) ?? [],
  )
  const [draftBusy, setDraftBusy] = React.useState(false)
  const draftCreateRef = React.useRef({
    onCreateSession,
    activeWorkspaceId,
    projectId: orchestrationProjectId ?? undefined,
    model: draftModel,
    connection: draftConnection,
    permissionMode: sessionOpts.permissionMode,
    thinkingLevel: sessionOpts.thinkingLevel,
    workingDirectory: draftWorkingDirectoryOverride,
    swarmEnabled: draftSwarmEnabled,
    sourceSlugs: draftSourceSlugs,
  })
  draftCreateRef.current = {
    onCreateSession,
    activeWorkspaceId,
    projectId: orchestrationProjectId ?? undefined,
    model: draftModel,
    connection: draftConnection,
    permissionMode: sessionOpts.permissionMode,
    thinkingLevel: sessionOpts.thinkingLevel,
    workingDirectory: draftWorkingDirectoryOverride,
    swarmEnabled: draftSwarmEnabled,
    sourceSlugs: draftSourceSlugs,
  }
  const submitDraftRef = React.useRef(createDraftSubmission<Session>(() => {
    const ctx = draftCreateRef.current
    return ctx.onCreateSession(ctx.activeWorkspaceId!, {
      projectId: ctx.projectId,
      model: ctx.model || undefined,
      llmConnection: ctx.connection,
      permissionMode: ctx.permissionMode,
      thinkingLevel: ctx.thinkingLevel,
      workingDirectory: ctx.workingDirectory ?? 'user_default',
      swarmEnabled: ctx.swarmEnabled,
      enabledSourceSlugs: ctx.sourceSlugs,
    })
  }))
  const settingsHydrated = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!isDraft) return
    submitDraftRef.current = createDraftSubmission<Session>(() => {
      const ctx = draftCreateRef.current
      return ctx.onCreateSession(ctx.activeWorkspaceId!, {
        projectId: ctx.projectId,
        model: ctx.model || undefined,
        llmConnection: ctx.connection,
        permissionMode: ctx.permissionMode,
        thinkingLevel: ctx.thinkingLevel,
        workingDirectory: ctx.workingDirectory ?? 'user_default',
        swarmEnabled: ctx.swarmEnabled,
        enabledSourceSlugs: ctx.sourceSlugs,
      })
    })
    const initial = llmConnections.find(c => c.slug === workspaceDefaultLlmConnection)
      ?? llmConnections.find(c => c.isDefault) ?? llmConnections[0]
    setDraftModel(initial?.defaultModel ?? '')
    setDraftConnection(initial?.slug)
    setDraftSwarmEnabled(false)
    setDraftWorkingDirectory(undefined)
    setWorkspaceWorkingDirectory(undefined)
    setDraftSourceSlugs(enabledSources?.map(source => source.config.slug) ?? [])
    setDraftBusy(false)
    setPermissionMode(defaultSessionOptions.permissionMode)
    setOption('thinkingLevel', defaultSessionOptions.thinkingLevel)
    settingsHydrated.current = null
    // Connection catalogs must not reset in-progress draft composer choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on draft entry / workspace
  }, [isDraft, activeWorkspaceId, orchestrationProjectId, setPermissionMode, setOption])

  React.useEffect(() => {
    if (!isDraft || !activeWorkspaceId || settingsHydrated.current === activeWorkspaceId) return
    let cancelled = false
    void window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then(settings => {
      if (cancelled || !settings) return
      settingsHydrated.current = activeWorkspaceId
      if (settings.permissionMode) setPermissionMode(settings.permissionMode)
      if (settings.thinkingLevel) setOption('thinkingLevel', settings.thinkingLevel)
      setWorkspaceWorkingDirectory(settings.workingDirectory)
      if (settings.enabledSourceSlugs) setDraftSourceSlugs(settings.enabledSourceSlugs)
    }).catch(error => {
      console.error('[ChatPage] Failed to load workspace settings:', error)
    })
    return () => { cancelled = true }
  }, [isDraft, activeWorkspaceId, orchestrationProjectId, setPermissionMode, setOption])

  // Track draft value for this session
  const [inputValue, setInputValue] = React.useState(() => coerceInputText(sessionId ? getDraft(sessionId) : ''))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(coerceInputText(sessionId ? getDraft(sessionId) : ''))
  }, [getDraft, sessionId])

  // Sync when draft is set externally (e.g., from notifications or shortcuts)
  // PERFORMANCE NOTE: This bounded polling (max 10 attempts × 50ms = 500ms)
  // handles external draft injection. Drafts use a ref for typing performance,
  // so they're not directly reactive. This polling only runs on session switch,
  // not continuously. Alternative: Add a Jotai atom for draft changes.
  React.useEffect(() => {
    if (!sessionId) return
    let attempts = 0
    const maxAttempts = 10
    const interval = setInterval(() => {
      const currentDraft = coerceInputText(getDraft(sessionId))
      if (currentDraft !== inputValueRef.current && currentDraft !== '') {
        setInputValue(currentDraft)
        clearInterval(interval)
      }
      attempts++
      if (attempts >= maxAttempts) {
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [sessionId, getDraft])

  // Listen for restore-input events (queued messages restored to input on abort)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId: targetId, text } = (e as CustomEvent).detail ?? {}
      if (sessionId && targetId === sessionId) {
        const nextText = coerceInputText(text)
        setInputValue(nextText)
        inputValueRef.current = nextText
      }
    }
    window.addEventListener('craft:restore-input', handler)
    return () => window.removeEventListener('craft:restore-input', handler)
  }, [sessionId])

  const handleInputChange = React.useCallback((value: string) => {
    const nextText = coerceInputText(value)
    setInputValue(nextText)
    inputValueRef.current = nextText
    if (sessionId) onInputChange(sessionId, nextText)
  }, [sessionId, onInputChange])

  // Attachments draft state — hydrated async from persisted refs on session switch.
  // `[]` is the safe default while hydration is in flight; FreeFormInput seeds its
  // local state from this prop and swaps in the restored list when ready.
  const [attachmentsValue, setAttachmentsValue] = React.useState<import('../../shared/types').FileAttachment[]>([])

  React.useEffect(() => {
    let cancelled = false
    setAttachmentsValue([])
    if (!sessionId) return () => { cancelled = true }
    hydrateDraftAttachments(sessionId).then((atts) => {
      if (!cancelled) setAttachmentsValue(atts)
    })
    return () => { cancelled = true }
  }, [sessionId, hydrateDraftAttachments])

  const handleAttachmentsChange = React.useCallback((attachments: import('../../shared/types').FileAttachment[]) => {
    setAttachmentsValue(attachments)
    if (sessionId) onAttachmentsChange(sessionId, attachments)
  }, [sessionId, onAttachmentsChange])

  // Session model change handler - persists per-session model and connection
  const handleModelChange = React.useCallback((model: string, connection?: string) => {
    if (!sessionId) {
      setDraftModel(model)
      if (connection) setDraftConnection(connection)
      return
    }
    if (activeWorkspaceId) {
      window.electronAPI.setSessionModel(
        sessionId,
        activeWorkspaceId,
        model.trim() ? model : null,
        connection,
      )
    }
  }, [sessionId, activeWorkspaceId])

  const handleConnectionChange = React.useCallback(async (connectionSlug: string) => {
    if (!sessionId) {
      setDraftConnection(connectionSlug)
      return
    }
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setConnection', connectionSlug })
    } catch (error) {
      console.error('Failed to change connection:', error)
    }
  }, [sessionId])

  // Check if session's locked connection has been removed
  const connectionUnavailable = React.useMemo(() =>
    isSessionConnectionUnavailable(
      isDraft ? draftConnection : session?.llmConnection,
      llmConnections,
      workspaceDefaultLlmConnection,
    ),
    [isDraft, draftConnection, session?.llmConnection, llmConnections, workspaceDefaultLlmConnection]
  )

  // Effective model for this session (session-specific or global fallback)
  const effectiveModel = React.useMemo(() => {
    if (isDraft) return draftModel
    if (session?.model) return session.model

    // When connection is unavailable, don't resolve through a different connection
    if (connectionUnavailable) return session?.model ?? ''

    const connectionSlug = resolveEffectiveConnectionSlug(
      session?.llmConnection, workspaceDefaultLlmConnection, llmConnections
    )
    const connection = connectionSlug ? llmConnections.find(c => c.slug === connectionSlug) : null

    return connection?.defaultModel ?? ''
  }, [isDraft, draftModel, session?.model, session?.llmConnection, workspaceDefaultLlmConnection, llmConnections, connectionUnavailable])

  // Working directory for this session
  const workingDirectory = isDraft ? draftWorkingDirectory : session?.workingDirectory
  const activeWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  )
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (isDraft) {
      setDraftWorkingDirectory(path)
      return
    }
    if (!session) return
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [isDraft, session])

  const handleOpenFile = React.useCallback(
    async (path: string) => {
      const baseDir = generatedFileBaseDir({
        workingDirectory,
        sessionFolderPath: session?.sessionFolderPath,
        workspaceRootPath: activeWorkspace?.rootPath,
      })
      try {
        const pick = await resolveOpenableGeneratedFile({
          requestedPath: path,
          baseDir,
          searchFiles: (dir, query) => window.electronAPI.searchFiles(dir, query),
        })
        if (pick.closestMatchRelativePath) {
          toast.info(t('chat.openedClosestMatch', { path: pick.closestMatchRelativePath }))
        }
        onOpenFile(pick.path)
      } catch (error) {
        toast.error(t('toast.failedToOpenFile'), { description: error instanceof Error ? error.message : String(error) })
      }
    },
    [onOpenFile, workingDirectory, session?.sessionFolderPath, activeWorkspace?.rootPath, t]
  )

  const handleOpenUrl = React.useCallback(
    (url: string) => {
      const resolved = resolveMarkdownLinkTarget(url)
      if (resolved.kind === 'file') {
        void handleOpenFile(resolved.path)
        return
      }
      onOpenUrl(url)
    },
    [onOpenUrl, handleOpenFile]
  )

  // Perf: Mark when data is ready
  const dataReadyMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (sessionId && messageLoadState.messagesReady && session && dataReadyMarkedRef.current !== sessionId) {
      dataReadyMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'data.ready')
    }
  }, [sessionId, messageLoadState.messagesReady, session])

  // Perf: Mark render complete after paint
  React.useEffect(() => {
    if (sessionId && session) {
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [sessionId, session])

  // Get display title for header - use getSessionTitle for consistent fallback logic with SessionList
  // Priority: name > first user message > preview > "New chat"
  const displayTitle = isDraft
    ? t('session.newSession')
    : session ? getSessionTitle(session) : (sessionMeta ? getSessionTitle(sessionMeta) : t('chat.session'))
  const isFlagged = session?.isFlagged || sessionMeta?.isFlagged || false
  const hasMessages = !!(session?.messages?.length || sessionMeta?.lastFinalMessageId)
  const hasUnreadMessages = sessionMeta
    ? !!(sessionMeta.lastFinalMessageId && sessionMeta.lastFinalMessageId !== sessionMeta.lastReadMessageId)
    : false
  // Use isAsyncOperationOngoing for shimmer effect (e.g. title regeneration)
  const isAsyncOperationOngoing = session?.isAsyncOperationOngoing || sessionMeta?.isAsyncOperationOngoing || false

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameName, setRenameName] = React.useState('')

  // Session action handlers
  const handleRename = React.useCallback(() => {
    setRenameName(displayTitle)
    setRenameDialogOpen(true)
  }, [displayTitle])

  const handleRenameSubmit = React.useCallback(() => {
    if (sessionId && renameName.trim() && renameName.trim() !== displayTitle) {
      onRenameSession(sessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
  }, [sessionId, renameName, displayTitle, onRenameSession])

  const handleMarkUnread = React.useCallback(() => {
    if (sessionId) onMarkSessionUnread(sessionId)
  }, [sessionId, onMarkSessionUnread])

  const swarmEnabled = isDraft ? draftSwarmEnabled : (session?.swarmEnabled ?? sessionMeta?.swarmEnabled ?? false)
  const orchestrationStatus = session?.orchestrationStatus ?? sessionMeta?.orchestrationStatus
  const swarmToggleDisabled = sessionMeta?.orchestrationRole === 'worker'
    || sessionMeta?.orchestrationRole === 'reviewer'
  const handleSwarmEnabledChange = React.useCallback(async (enabled: boolean) => {
    if (!sessionId) {
      setDraftSwarmEnabled(enabled)
      return
    }
    const previous = session?.swarmEnabled ?? sessionMeta?.swarmEnabled ?? false
    updateSession(sessionId, current => current ? { ...current, swarmEnabled: enabled } : current)
    updateSessionMeta(sessionId, { swarmEnabled: enabled })
    try {
      await window.electronAPI.setSessionSwarmEnabled(sessionId, enabled)
    } catch (error) {
      updateSession(sessionId, current => current ? { ...current, swarmEnabled: previous } : current)
      updateSessionMeta(sessionId, { swarmEnabled: previous })
      console.error('[ChatPage] Failed to update Swarm mode:', error)
      toast.error(t('common.error'))
    }
  }, [sessionId, session?.swarmEnabled, sessionMeta?.swarmEnabled, updateSession, updateSessionMeta, t])

  // Task orchestrator sessions (spec-backed, top-level) get an "Edit task" header action
  // that opens the board's full-pane Task editor prefilled from task.yaml — the same
  // surface as creation, so goal/acceptance criteria/subtasks can change and the whole
  // task can be re-run (Save & Run mints a fresh Conductor run).
  const taskSlug = session?.taskSlug ?? sessionMeta?.taskSlug
  const isTaskOrchestrator = !!taskSlug && !(session?.parentSessionId || sessionMeta?.parentSessionId)
  const setKanbanEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const handleEditTask = React.useCallback(() => {
    if (!taskSlug || !sessionId) return
    setKanbanEditorTarget({
      mode: 'edit',
      sessionId,
      taskSlug,
      initialTitle: sessionMeta ? getSessionTitle(sessionMeta) : undefined,
    })
    navigate(routes.view.board())
  }, [taskSlug, sessionId, sessionMeta, setKanbanEditorTarget])

  const handlePreviewOrchestrationNode = React.useCallback((childSessionId: string) => {
    if (!sessionId || !canPreviewOrchestrationChild(sessionId, sessionMetaMap.get(childSessionId))) return
    setPreviewChildSessionId(childSessionId)
  }, [sessionId, sessionMetaMap])

  const orchestrationProgress = !isDraft && isTaskOrchestrator && activeWorkspaceId && taskSlug && sessionId ? (
    <OrchestrationRunProgress
      workspaceId={activeWorkspaceId}
      taskSlug={taskSlug}
      sessionId={sessionId}
      runningHint={orchestrationStatus === 'running'}
      onPreviewSession={handlePreviewOrchestrationNode}
    />
  ) : null

  const handleDelete = React.useCallback(async () => {
    if (sessionId) await onDeleteSession(sessionId)
  }, [sessionId, onDeleteSession])

  const handleOpenInNewWindow = React.useCallback(async () => {
    if (!sessionId) return
    const route = routes.view.allSessions(sessionId)
    const separator = route.includes('?') ? '&' : '?'
    const url = `craftagents://${route}${separator}window=focused`
    try {
      await window.electronAPI?.openUrl(url)
    } catch (error) {
      console.error('[ChatPage] openUrl failed:', error)
    }
  }, [sessionId])

  const compactInfoButton = React.useMemo(() => {
    if (!isCompactMode || !sessionMeta) return undefined

    return (
      <SessionInfoPopover
        sessionId={sessionMeta.id}
        sessionFolderPath={session?.sessionFolderPath}
        presentation="drawer"
        trigger={(
          <PanelHeaderCenterButton
            icon={<FolderOpen className="h-4 w-4" />}
            aria-label={t("chat.sessionInfo")}
          />
        )}
      />
    )
  }, [isCompactMode, session?.sessionFolderPath, sessionMeta, t])

  // Topology action opens the definition editor for orchestrator sessions. Compact mode also
  // shows session info; desktop online-share control has been removed.
  const editTaskButton = React.useMemo(() => {
    if (!isTaskOrchestrator) return undefined
    return (
      <TaskOrchestrationEditButton
        compact={!!isCompactMode}
        onEdit={handleEditTask}
      />
    )
  }, [isTaskOrchestrator, handleEditTask, isCompactMode])

  const primaryHeaderAction = isCompactMode ? compactInfoButton : undefined
  const headerActions = editTaskButton && primaryHeaderAction ? (
    <div className="flex items-center gap-1.5">
      {editTaskButton}
      {primaryHeaderAction}
    </div>
  ) : (editTaskButton ?? primaryHeaderAction)

  // Build title menu content for chat sessions using shared SessionMenu.
  // Desktop uses Radix DropdownMenu via PanelHeader; compact mode uses a
  // vaul Drawer (CompactSessionMenu) so submenus aren't clipped by the
  // panel container query on narrow viewports.
  const titleMenu = React.useMemo(() => (sessionMeta && !isCompactMode) ? (
    <SessionMenu
      item={sessionMeta}
      onRename={handleRename}
      onMarkUnread={handleMarkUnread}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ) : null, [
    sessionMeta,
    isCompactMode,
    handleRename,
    handleMarkUnread,
    handleOpenInNewWindow,
    handleDelete,
  ])

  const compactTitleMenu = React.useMemo(() => (sessionMeta && isCompactMode) ? (
    <CompactSessionMenu
      title={displayTitle}
      isRegeneratingTitle={isAsyncOperationOngoing}
      item={sessionMeta}
      onRename={handleRename}
      onMarkUnread={handleMarkUnread}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ) : null, [
    sessionMeta,
    isCompactMode,
    displayTitle,
    isAsyncOperationOngoing,
    handleRename,
    handleMarkUnread,
    handleOpenInNewWindow,
    handleDelete,
  ])

  const childPreviewDialog = (
    <ChildSessionPreviewDialog
      sessionId={previewChildSessionId}
      open={previewChildSessionId !== null}
      onOpenChange={(open) => {
        if (!open) setPreviewChildSessionId(null)
      }}
    />
  )

  const draftSession = React.useMemo(() => createDraftDisplaySession({
    workspaceId: activeWorkspaceId ?? '',
    model: draftModel,
    llmConnection: draftConnection,
    workingDirectory: draftWorkingDirectory,
    enabledSourceSlugs: draftSourceSlugs,
    swarmEnabled: draftSwarmEnabled,
    projectId: orchestrationProjectId ?? undefined,
  }), [
    activeWorkspaceId,
    draftModel,
    draftConnection,
    draftWorkingDirectory,
    draftSourceSlugs,
    draftSwarmEnabled,
    orchestrationProjectId,
  ])

  const pendingCreatedSessionRef = React.useRef<Session | null>(null)
  const handleSendMessage = React.useCallback((message: string, attachments?: import('../../shared/types').FileAttachment[], skillSlugs?: string[]) => {
    if (isDraft) {
      if (!activeWorkspaceId || draftBusy) return
      setDraftBusy(true)
      void submitDraftRef.current(async (created) => {
        pendingCreatedSessionRef.current = created
        onSendMessage(created.id, message, attachments, skillSlugs)
        navigate(routes.view.allSessions(created.id))
      }).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        setDraftBusy(false)
      })
      return
    }
    if (session) onSendMessage(session.id, message, attachments, skillSlugs)
  }, [isDraft, activeWorkspaceId, draftBusy, onSendMessage, session])

  if (session && pendingCreatedSessionRef.current?.id === session.id) {
    pendingCreatedSessionRef.current = null
  }
  const displaySession = session
    ?? (pendingCreatedSessionRef.current && pendingCreatedSessionRef.current.id === sessionId
      ? pendingCreatedSessionRef.current
      : null)
    ?? (isDraft ? draftSession : null)

  const handleSourcesChange = React.useCallback((slugs: string[]) => {
    if (!sessionId) {
      setDraftSourceSlugs(slugs)
      return
    }
    onSessionSourcesChange?.(sessionId, slugs)
  }, [sessionId, onSessionSourcesChange])

  // Handle missing session - loading or deleted
  if (!isDraft && !displaySession) {
    if (sessionMeta) {
      // Session exists in metadata but not loaded yet - show loading state
      const skeletonSession = {
        id: sessionMeta.id,
        workspaceId: sessionMeta.workspaceId,
        workspaceName: '',
        name: sessionMeta.name,
        preview: sessionMeta.preview,
        lastMessageAt: sessionMeta.lastMessageAt || 0,
        messages: [],
        isProcessing: sessionMeta.isProcessing || false,
        isFlagged: sessionMeta.isFlagged,
        workingDirectory: sessionMeta.workingDirectory,
        enabledSourceSlugs: sessionMeta.enabledSourceSlugs,
        projectId: sessionMeta.projectId,
        sharedProjectMemoryEnabled: sessionMeta.sharedProjectMemoryEnabled,
        swarmEnabled: sessionMeta.swarmEnabled,
        taskSlug: sessionMeta.taskSlug,
        parentSessionId: sessionMeta.parentSessionId,
        orchestrationRole: sessionMeta.orchestrationRole,
        orchestrationStatus: sessionMeta.orchestrationStatus,
        orchestrationBlocker: sessionMeta.orchestrationBlocker,
        orchestrationTokensUsed: sessionMeta.orchestrationTokensUsed,
        orchestrationTokenBudget: sessionMeta.orchestrationTokenBudget,
      }

      return (
        <>
          <div className="h-full flex flex-col">
            <PanelHeader title={displayTitle} titleMenu={titleMenu} compactTitleMenu={compactTitleMenu} leadingAction={leadingAction} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
            <div className="flex-1 flex flex-col min-h-0">
              {orchestrationProgress}
              <ChatDisplay
                ref={chatDisplayRef}
                session={skeletonSession}
                onSendMessage={() => {}}
                onOpenFile={handleOpenFile}
                onOpenUrl={handleOpenUrl}
                currentModel={effectiveModel}
                onModelChange={handleModelChange}
                onConnectionChange={handleConnectionChange}
                pendingPermission={undefined}
                onRespondToPermission={onRespondToPermission}
                pendingCredential={undefined}
                onRespondToCredential={onRespondToCredential}
                thinkingLevel={sessionOpts.thinkingLevel}
                onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
                permissionMode={sessionOpts.permissionMode}
                onPermissionModeChange={setPermissionMode}
                enabledModes={enabledModes}
                inputValue={inputValue}
                onInputChange={handleInputChange}
                attachmentsValue={attachmentsValue}
                onAttachmentsChange={handleAttachmentsChange}
                sources={enabledSources}
                skills={skills}
                swarmEnabled={swarmEnabled}
                onSwarmEnabledChange={handleSwarmEnabledChange}
                swarmToggleDisabled={swarmToggleDisabled}
                swarmRunning={orchestrationStatus === 'running'}
                workspaceId={activeWorkspaceId || undefined}
                onSourcesChange={handleSourcesChange}
                workingDirectory={sessionMeta.workingDirectory}
                composerSessionId={sessionId}
                onWorkingDirectoryChange={handleWorkingDirectoryChange}
                messagesLoading={messageLoadState.messagesLoading || (messagesRetrying && !messageLoadState.messagesReady)}
                messagesLoadError={messageLoadState.error}
                messagesRetrying={messagesRetrying}
                onRetryMessagesLoad={handleRetryMessagesLoad}
                searchQuery={sessionListSearchQuery}
                isSearchModeActive={isSearchModeActive}
                onMatchInfoChange={onChatMatchInfoChange}
                connectionUnavailable={connectionUnavailable}
                compactMode={!!isCompactMode}
                enableCompactModelPicker={!!isCompactMode}
                onPreviewSession={setPreviewChildSessionId}
              />
            </div>
          </div>
          <RenameDialog
            open={renameDialogOpen}
            onOpenChange={setRenameDialogOpen}
            title={t('chat.renameSession')}
            value={renameName}
            onValueChange={setRenameName}
            onSubmit={handleRenameSubmit}
            placeholder={t('chat.enterSessionName')}
          />
          {childPreviewDialog}
        </>
      )
    }

    // Session truly doesn't exist
    return (
      <div className="h-full flex flex-col">
        <PanelHeader  title={t('chat.session')} leadingAction={leadingAction} rightSidebarButton={rightSidebarButton} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">{t('chat.sessionNoLongerExists')}</p>
        </div>
      </div>
    )
  }

  return (
    <ResponseSourcesLayout resizeHandle={SourcesResizeHandle} key={sessionId ?? 'draft'} messages={(displaySession ?? draftSession).messages} onOpenUrl={handleOpenUrl}
      renderHeader={(title, onClose) => <PanelHeader title={title} leadingAction={<></>} compensateForStoplight={false} rightSidebarButton={<PanelHeaderCenterButton icon={<X className="size-4" />} onClick={onClose} tooltip={t('common.close')} />} />}>
      <div className="h-full flex flex-col">
        <PanelHeader title={displayTitle} titleMenu={titleMenu} compactTitleMenu={compactTitleMenu} leadingAction={leadingAction} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
        <div className="flex-1 flex flex-col min-h-0">
          {orchestrationProgress}
          <ChatDisplay
            ref={chatDisplayRef}
            session={displaySession ?? draftSession}
            onSendMessage={handleSendMessage}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            currentModel={effectiveModel}
            onModelChange={handleModelChange}
            onConnectionChange={handleConnectionChange}
            disabled={draftBusy}
            pendingPermission={pendingPermission}
            onRespondToPermission={onRespondToPermission}
            pendingCredential={pendingCredential}
            onRespondToCredential={onRespondToCredential}
            thinkingLevel={sessionOpts.thinkingLevel}
            onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
            permissionMode={sessionOpts.permissionMode}
            onPermissionModeChange={setPermissionMode}
            enabledModes={enabledModes}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            attachmentsValue={attachmentsValue}
            onAttachmentsChange={handleAttachmentsChange}
            sources={enabledSources}
            skills={skills}
            swarmEnabled={swarmEnabled}
            onSwarmEnabledChange={handleSwarmEnabledChange}
            swarmToggleDisabled={swarmToggleDisabled}
            swarmRunning={orchestrationStatus === 'running'}
            workspaceId={activeWorkspaceId || undefined}
            onSourcesChange={handleSourcesChange}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            sessionFolderPath={session?.sessionFolderPath}
            composerSessionId={sessionId}
            messagesLoading={messageLoadState.messagesLoading || (messagesRetrying && !messageLoadState.messagesReady)}
            messagesLoadError={messageLoadState.error}
            messagesRetrying={messagesRetrying}
            onRetryMessagesLoad={handleRetryMessagesLoad}
            searchQuery={sessionListSearchQuery}
            isSearchModeActive={isSearchModeActive}
            onMatchInfoChange={onChatMatchInfoChange}
            connectionUnavailable={connectionUnavailable}
            compactMode={!!isCompactMode}
            enableCompactModelPicker={!!isCompactMode}
            onPreviewSession={setPreviewChildSessionId}
          />
        </div>
      </div>
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t('chat.renameSession')}
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder={t('chat.enterSessionName')}
      />
      {childPreviewDialog}
    </ResponseSourcesLayout>
  )
})

export default ChatPage
