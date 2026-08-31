/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, Info, Pencil } from 'lucide-react'
import { ChatDisplay, type ChatDisplayHandle } from '@/components/app-shell/ChatDisplay'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SessionMenu } from '@/components/app-shell/SessionMenu'
import { CompactSessionMenu } from '@/components/app-shell/CompactSessionMenu'
import { SessionInfoPopover } from '@/components/app-shell/SessionInfoPopover'
import { OrchestrationStatusBadge } from '@/components/app-shell/OrchestrationStatusBadge'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { toast } from 'sonner'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { generatedFileBaseDir, resolveOpenableGeneratedFile } from '@/lib/generated-file-path'
import { resolveMarkdownLinkTarget } from '@craft-agent/ui'
import { navigate, routes } from '@/lib/navigate'
import { coerceInputText } from '@/lib/input-text'
import { deriveSessionMessagesLoadState, formatSessionLoadFailure } from '@/lib/session-load'
import {
  ensureSessionMessagesLoadedAtom,
  forceSessionMessagesReloadAtom,
  loadedSessionsAtom,
  sessionMetaMapAtom,
  updateSessionAtom,
  updateSessionMetaAtom,
} from '@/atoms/sessions'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { getSessionTitle } from '@/utils/session'
// Model resolution: connection.defaultModel (no hardcoded defaults)
import { resolveEffectiveConnectionSlug, isSessionConnectionUnavailable } from '@config/llm-connections'

export interface ChatPageProps {
  sessionId: string
}

const ChatPage = React.memo(function ChatPage({ sessionId }: ChatPageProps) {
  const { t } = useTranslation()
  // Diagnostic: mark when component runs
  React.useLayoutEffect(() => {
    rendererPerf.markSessionSwitch(sessionId, 'panel.mounted')
  }, [sessionId])

  const {
    activeWorkspaceId,
    llmConnections,
    workspaceDefaultLlmConnection,
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
    labels,
    onSessionLabelsChange,
    enabledModes,
    sessionStatuses,
    onSessionSourcesChange,
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onSessionStatusChange,
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
  } = useSessionOptionsFor(sessionId)

  // Use per-session atom for isolated updates
  const session = useSessionData(sessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = loadedSessions.has(sessionId)

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionMetaMap.get(sessionId)

  // Fallback: ensure messages are loaded when session is viewed
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const forceMessagesReload = useSetAtom(forceSessionMessagesReloadAtom)
  const updateSession = useSetAtom(updateSessionAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const [messagesLoadError, setMessagesLoadError] = React.useState<string | null>(null)
  const [messagesRetrying, setMessagesRetrying] = React.useState(false)
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
    if (session && sessionLoadedMarkedRef.current !== sessionId) {
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
    if (session && isWindowFocused && isFocusedPanel !== false) {
      onSetActiveViewingSession(session.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isWindowFocused, isFocusedPanel, onSetActiveViewingSession])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  // Track draft value for this session
  const [inputValue, setInputValue] = React.useState(() => coerceInputText(getDraft(sessionId)))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(coerceInputText(getDraft(sessionId)))
  }, [getDraft, sessionId])

  // Sync when draft is set externally (e.g., from notifications or shortcuts)
  // PERFORMANCE NOTE: This bounded polling (max 10 attempts × 50ms = 500ms)
  // handles external draft injection. Drafts use a ref for typing performance,
  // so they're not directly reactive. This polling only runs on session switch,
  // not continuously. Alternative: Add a Jotai atom for draft changes.
  React.useEffect(() => {
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
      if (targetId === sessionId) {
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
    onInputChange(sessionId, nextText)
  }, [sessionId, onInputChange])

  // Attachments draft state — hydrated async from persisted refs on session switch.
  // `[]` is the safe default while hydration is in flight; FreeFormInput seeds its
  // local state from this prop and swaps in the restored list when ready.
  const [attachmentsValue, setAttachmentsValue] = React.useState<import('../../shared/types').FileAttachment[]>([])

  React.useEffect(() => {
    let cancelled = false
    setAttachmentsValue([])
    hydrateDraftAttachments(sessionId).then((atts) => {
      if (!cancelled) setAttachmentsValue(atts)
    })
    return () => { cancelled = true }
  }, [sessionId, hydrateDraftAttachments])

  const handleAttachmentsChange = React.useCallback((attachments: import('../../shared/types').FileAttachment[]) => {
    setAttachmentsValue(attachments)
    onAttachmentsChange(sessionId, attachments)
  }, [sessionId, onAttachmentsChange])

  // Session model change handler - persists per-session model and connection
  const handleModelChange = React.useCallback((model: string, connection?: string) => {
    if (activeWorkspaceId) {
      window.electronAPI.setSessionModel(sessionId, activeWorkspaceId, model, connection)
    }
  }, [sessionId, activeWorkspaceId])

  const handleConnectionChange = React.useCallback(async (connectionSlug: string) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setConnection', connectionSlug })
    } catch (error) {
      console.error('Failed to change connection:', error)
    }
  }, [sessionId])

  // Check if session's locked connection has been removed
  const connectionUnavailable = React.useMemo(() =>
    isSessionConnectionUnavailable(session?.llmConnection, llmConnections, workspaceDefaultLlmConnection),
    [session?.llmConnection, llmConnections, workspaceDefaultLlmConnection]
  )

  // Effective model for this session (session-specific or global fallback)
  const effectiveModel = React.useMemo(() => {
    if (session?.model) return session.model

    // When connection is unavailable, don't resolve through a different connection
    if (connectionUnavailable) return session?.model ?? ''

    const connectionSlug = resolveEffectiveConnectionSlug(
      session?.llmConnection, workspaceDefaultLlmConnection, llmConnections
    )
    const connection = connectionSlug ? llmConnections.find(c => c.slug === connectionSlug) : null

    return connection?.defaultModel ?? ''
  }, [session?.id, session?.model, session?.llmConnection, workspaceDefaultLlmConnection, llmConnections, connectionUnavailable])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  const activeWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  )
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [session])

  const handleOpenFile = React.useCallback(
    async (path: string) => {
      const baseDir = generatedFileBaseDir({
        workingDirectory,
        sessionFolderPath: session?.sessionFolderPath,
        workspaceRootPath: activeWorkspace?.rootPath,
      })
      const pick = await resolveOpenableGeneratedFile({
        requestedPath: path,
        baseDir,
        searchFiles: (dir, query) => window.electronAPI.searchFiles(dir, query),
      })
      if (pick.closestMatchRelativePath) {
        toast.info(t('chat.openedClosestMatch', { path: pick.closestMatchRelativePath }))
      }
      onOpenFile(pick.path)
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
    if (messageLoadState.messagesReady && session && dataReadyMarkedRef.current !== sessionId) {
      dataReadyMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'data.ready')
    }
  }, [sessionId, messageLoadState.messagesReady, session])

  // Perf: Mark render complete after paint
  React.useEffect(() => {
    if (session) {
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [sessionId, session])

  // Get display title for header - use getSessionTitle for consistent fallback logic with SessionList
  // Priority: name > first user message > preview > "New chat"
  const displayTitle = session ? getSessionTitle(session) : (sessionMeta ? getSessionTitle(sessionMeta) : t('chat.session'))
  const isFlagged = session?.isFlagged || sessionMeta?.isFlagged || false
  const isArchived = session?.isArchived || sessionMeta?.isArchived || false
  const currentSessionStatus = session?.sessionStatus || sessionMeta?.sessionStatus || 'todo'
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
    if (renameName.trim() && renameName.trim() !== displayTitle) {
      onRenameSession(sessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
  }, [sessionId, renameName, displayTitle, onRenameSession])

  const handleFlag = React.useCallback(() => {
    onFlagSession(sessionId)
  }, [sessionId, onFlagSession])

  const handleUnflag = React.useCallback(() => {
    onUnflagSession(sessionId)
  }, [sessionId, onUnflagSession])

  const handleArchive = React.useCallback(() => {
    onArchiveSession(sessionId)
  }, [sessionId, onArchiveSession])

  const handleUnarchive = React.useCallback(() => {
    onUnarchiveSession(sessionId)
  }, [sessionId, onUnarchiveSession])

  const handleMarkUnread = React.useCallback(() => {
    onMarkSessionUnread(sessionId)
  }, [sessionId, onMarkSessionUnread])

  const handleSessionStatusChange = React.useCallback((state: string) => {
    onSessionStatusChange(sessionId, state)
  }, [sessionId, onSessionStatusChange])

  const handleLabelsChange = React.useCallback((newLabels: string[]) => {
    onSessionLabelsChange?.(sessionId, newLabels)
  }, [sessionId, onSessionLabelsChange])

  const swarmEnabled = session?.swarmEnabled ?? sessionMeta?.swarmEnabled ?? false
  const orchestrationStatus = session?.orchestrationStatus ?? sessionMeta?.orchestrationStatus
  const swarmToggleDisabled = sessionMeta?.orchestrationRole === 'worker'
    || sessionMeta?.orchestrationRole === 'reviewer'
  const handleSwarmEnabledChange = React.useCallback(async (enabled: boolean) => {
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

  const handleStopSwarm = React.useCallback(async () => {
    try {
      await window.electronAPI.stopSessionSwarm(sessionId)
    } catch (error) {
      console.error('[ChatPage] Failed to stop Swarm:', error)
      toast.error(t('common.error'))
    }
  }, [sessionId, t])

  const handleSwarmBudgetIncrease = React.useCallback(async (tokenBudget: number) => {
    try {
      await window.electronAPI.updateSessionSwarmBudget(sessionId, tokenBudget)
    } catch (error) {
      console.error('[ChatPage] Failed to update Swarm token budget:', error)
      toast.error(t('common.error'), { description: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }, [sessionId, t])

  // Task orchestrator sessions (spec-backed, top-level) get an "Edit task" header action
  // that opens the board's full-pane Task editor prefilled from task.yaml — the same
  // surface as creation, so goal/acceptance criteria/subtasks can change and the whole
  // task can be re-run (Save & Run mints a fresh Conductor run).
  const taskSlug = sessionMeta?.taskSlug
  const isTaskOrchestrator = !!taskSlug && !sessionMeta?.parentSessionId
  const setKanbanEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const handleEditTask = React.useCallback(() => {
    if (!taskSlug) return
    setKanbanEditorTarget({
      mode: 'edit',
      sessionId,
      taskSlug,
      initialTitle: sessionMeta ? getSessionTitle(sessionMeta) : undefined,
    })
    navigate(routes.view.board())
  }, [taskSlug, sessionId, sessionMeta, setKanbanEditorTarget])

  const orchestrationBadge = (
    <OrchestrationStatusBadge
      status={session?.orchestrationStatus ?? sessionMeta?.orchestrationStatus}
      blocker={session?.orchestrationBlocker ?? sessionMeta?.orchestrationBlocker}
      onOpenDetails={isTaskOrchestrator ? handleEditTask : undefined}
    />
  )

  const handleDelete = React.useCallback(async () => {
    await onDeleteSession(sessionId)
  }, [sessionId, onDeleteSession])

  const handleOpenInNewWindow = React.useCallback(async () => {
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
        sessionId={sessionId}
        sessionFolderPath={session?.sessionFolderPath}
        presentation="drawer"
        trigger={(
          <PanelHeaderCenterButton
            icon={<Info className="h-4 w-4" />}
            aria-label={t("chat.sessionInfo")}
          />
        )}
      />
    )
  }, [isCompactMode, sessionId, session?.sessionFolderPath, sessionMeta])

  // Pencil opens the Task editor for orchestrator sessions. Compact mode also
  // shows session info; desktop online-share control has been removed.
  const editTaskButton = React.useMemo(() => {
    if (!isTaskOrchestrator) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<Pencil className="h-4 w-4" />}
        tooltip={t('kanban.editTask')}
        onClick={handleEditTask}
      />
    )
  }, [isTaskOrchestrator, handleEditTask, t])

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
      sessionStatuses={sessionStatuses ?? []}
      labels={labels ?? []}
      onLabelsChange={handleLabelsChange}
      onRename={handleRename}
      onFlag={handleFlag}
      onUnflag={handleUnflag}
      onArchive={handleArchive}
      onUnarchive={handleUnarchive}
      onMarkUnread={handleMarkUnread}
      onSessionStatusChange={handleSessionStatusChange}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ) : null, [
    sessionMeta,
    isCompactMode,
    sessionStatuses,
    labels,
    handleLabelsChange,
    handleRename,
    handleFlag,
    handleUnflag,
    handleArchive,
    handleUnarchive,
    handleMarkUnread,
    handleSessionStatusChange,
    handleOpenInNewWindow,
    handleDelete,
  ])

  const compactTitleMenu = React.useMemo(() => (sessionMeta && isCompactMode) ? (
    <CompactSessionMenu
      title={displayTitle}
      isRegeneratingTitle={isAsyncOperationOngoing}
      item={sessionMeta}
      sessionStatuses={sessionStatuses ?? []}
      labels={labels ?? []}
      onLabelsChange={handleLabelsChange}
      onRename={handleRename}
      onFlag={handleFlag}
      onUnflag={handleUnflag}
      onArchive={handleArchive}
      onUnarchive={handleUnarchive}
      onMarkUnread={handleMarkUnread}
      onSessionStatusChange={handleSessionStatusChange}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ) : null, [
    sessionMeta,
    isCompactMode,
    displayTitle,
    isAsyncOperationOngoing,
    sessionStatuses,
    labels,
    handleLabelsChange,
    handleRename,
    handleFlag,
    handleUnflag,
    handleArchive,
    handleUnarchive,
    handleMarkUnread,
    handleSessionStatusChange,
    handleOpenInNewWindow,
    handleDelete,
  ])

  // Handle missing session - loading or deleted
  if (!session) {
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
        orchestrationRole: sessionMeta.orchestrationRole,
        orchestrationStatus: sessionMeta.orchestrationStatus,
        orchestrationBlocker: sessionMeta.orchestrationBlocker,
        orchestrationTokensUsed: sessionMeta.orchestrationTokensUsed,
        orchestrationTokenBudget: sessionMeta.orchestrationTokenBudget,
      }

      return (
        <>
          <div className="h-full flex flex-col">
            <PanelHeader title={displayTitle} badge={orchestrationBadge} titleMenu={titleMenu} compactTitleMenu={compactTitleMenu} leadingAction={leadingAction} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
            <div className="flex-1 flex flex-col min-h-0">
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
                sessionStatuses={sessionStatuses}
                onSessionStatusChange={handleSessionStatusChange}
                swarmEnabled={swarmEnabled}
                onSwarmEnabledChange={handleSwarmEnabledChange}
                swarmToggleDisabled={swarmToggleDisabled}
                swarmRunning={orchestrationStatus === 'running'}
                onStopSwarm={handleStopSwarm}
                swarmTokensUsed={sessionMeta.orchestrationTokensUsed ?? 0}
                swarmTokenBudget={sessionMeta.orchestrationTokenBudget}
                onSwarmBudgetIncrease={handleSwarmBudgetIncrease}
                workspaceId={activeWorkspaceId || undefined}
                onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
                workingDirectory={sessionMeta.workingDirectory}
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
    <>
      <div className="h-full flex flex-col">
        <PanelHeader title={displayTitle} badge={orchestrationBadge} titleMenu={titleMenu} compactTitleMenu={compactTitleMenu} leadingAction={leadingAction} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
        <div className="flex-1 flex flex-col min-h-0">
          <ChatDisplay
            ref={chatDisplayRef}
            session={session}
            onSendMessage={(message, attachments, skillSlugs) => {
              if (session) {
                onSendMessage(session.id, message, attachments, skillSlugs)
              }
            }}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            currentModel={effectiveModel}
            onModelChange={handleModelChange}
            onConnectionChange={handleConnectionChange}
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
            labels={labels}
            onLabelsChange={(newLabels) => onSessionLabelsChange?.(sessionId, newLabels)}
            sessionStatuses={sessionStatuses}
            onSessionStatusChange={handleSessionStatusChange}
            swarmEnabled={swarmEnabled}
            onSwarmEnabledChange={handleSwarmEnabledChange}
            swarmToggleDisabled={swarmToggleDisabled}
            swarmRunning={orchestrationStatus === 'running'}
            onStopSwarm={handleStopSwarm}
            swarmTokensUsed={session?.orchestrationTokensUsed ?? sessionMeta?.orchestrationTokensUsed ?? 0}
            swarmTokenBudget={session?.orchestrationTokenBudget ?? sessionMeta?.orchestrationTokenBudget}
            onSwarmBudgetIncrease={handleSwarmBudgetIncrease}
            workspaceId={activeWorkspaceId || undefined}
            onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            sessionFolderPath={session?.sessionFolderPath}
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
    </>
  )
})

export default ChatPage
