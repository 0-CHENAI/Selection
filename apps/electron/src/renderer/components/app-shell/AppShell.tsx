import * as React from "react"
import { useTranslation, Trans } from "react-i18next"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue, useStore } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  Settings,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RotateCw,
  Search,
  Plus,
  FileUp,
  Copy,
  DatabaseZap,
  Sparkles,
  Inbox,
  Globe,
  FolderOpen,
  Webhook,
  Clock,
  Radio,
  Bot,
  Info,
  FolderKanban,
} from "lucide-react"
// SessionStatusIcons no longer used - icons come from dynamic sessionStatuses
import { SourceAvatar } from "@/components/ui/source-avatar"
import { TopBar } from "./TopBar"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { McpIcon } from "../icons/McpIcon"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { CreationJobsButton, CreationJobsHost } from "./CreationJobsButton"
import type { CreationJob } from "@/atoms/creation-jobs"
import { clearProjectFilter, resolveNewSessionParams, resolveProjectNavigationSessionId, type FilterMode } from "./inherited-filter-params"
import { filterSessionsByProject, getIncludedProjectName, hasIncludedProjectFilter } from "./project-session-filter"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { ContextMenuProvider } from "@/components/ui/menu-context"
import { SidebarMenu } from "./SidebarMenu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FadingText } from "@/components/ui/fading-text"
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
  springTransition as collapsibleSpring,
} from "@/components/ui/collapsible"
import { SessionList } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import { BoardListToggle } from "./kanban/BoardListToggle"
import { PanelStackContainer } from "./PanelStackContainer"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { LeftSidebar } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useAction, useActionLabel } from "@/actions"
import { useFocusZone } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, FileAttachment, PermissionRequest, LoadedSource, LoadedSkill, PermissionMode, SourceFilter, AutomationFilter } from "../../../shared/types"
import { sessionMetaMapAtom, sendToWorkspaceAtom, type SessionMeta } from "@/atoms/sessions"
import { isOrdinarySessionVisible } from '@/lib/swarm-session'
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { panelStackAtom, panelCountAtom, focusedPanelIdAtom, focusedSessionIdAtom, focusNextPanelAtom, focusPrevPanelAtom, parseSessionIdFromRoute } from "@/atoms/panel-stack"
import { type SessionStatusId, type SessionStatus, statusConfigsToSessionStatuses } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useViews } from "@/hooks/useViews"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { findLabelById, sortLabelsForDisplay } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  type NavigationState,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import {
  ExternalResourceImportDialog,
  SkillFileDropDialog,
  SkillFileImportDialog,
} from "@/components/resources/ExternalResourceImportDialog"
import {
  getDroppedSkillImportFile,
  openSkillFilePicker,
  prepareSkillFileImport,
  listenForSkillFilePickerCancel,
  releaseSkillFilePicker,
  type PreparedSkillFileImport,
} from "@/components/resources/external-resource-import"
import { AutomationsListPanel } from "../automations/AutomationsListPanel"
import { ProjectsListPanel } from "./ProjectsListPanel"
import { APP_EVENTS, AGENT_EVENTS, type AutomationFilterKind, AUTOMATION_TYPE_TO_FILTER_KIND } from "../automations/types"
import { useAutomations } from "@/hooks/useAutomations"
import { useProjects } from "@/hooks/useProjects"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PanelHeader } from "./PanelHeader"
import { FabNewChat } from "./FabNewChat"
import { SendToWorkspaceDialog } from "./SendToWorkspaceDialog"
import { CreateProjectDialog } from "../projects/CreateProjectDialog"
import { MessagingDialogHost } from "@/components/messaging/MessagingDialogHost"
import { EditPopover, getEditConfig, type EditContextKey } from "@/components/ui/EditPopover"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from "./panel-constants"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import {
  CREATION_COMPLETED_EVENT,
  type CreationCompletedEventDetail,
} from "@/lib/creation-job-validation"
import { dispatchFocusInputEvent } from "./input/focus-input-events"
import {
  prepareOrdinarySessionSidebarLinks,
  sanitizeRemovedSessionFilters,
  sanitizeSidebarProjectScope,
} from "./ordinary-session-ui"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to AppShellContextType in context/AppShellContext.tsx
 * 2. Update App.tsx to include in contextValue
 * 3. Use via useAppShellContext() hook in child components
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides sidebars, shows only the chat content */
  isFocusedMode?: boolean
}

/**
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [NavigatorPanel 32%] | [MainContentPanel 48%]
 *
 * Session list: ordinary sessions plus optional project scope. Legacy
 * classification routes still parse, then redirect into this list.
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

/**
 * AppShellContent - Inner component that contains all the AppShell logic
 * Separated to allow useEscapeInterrupt hook to work (must be inside provider)
 */
function AppShellContent({
  contextValue,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  menuNewChatTrigger,
  isFocusedMode = false,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    sessionOptions,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSessionStatusChange,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    onReset,
    onSendMessage,
    openNewChat,
    pendingPermissions,
  } = contextValue

  const { t } = useTranslation()

  // Get hotkey labels from centralized action registry
  const newChatHotkey = useActionLabel('app.newChat').hotkey

  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarVisible, !defaultCollapsed)
  })
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarWidth, 220)
  })
  // Session list width in pixels (min 240, max 480)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sessionListWidth, 300)
  })

  // Hides both sidebar and navigator (CMD+. toggle)
  // Seed from either focused window param or persisted preference, then keep it toggleable.
  const [isSidebarAndNavigatorHidden, setIsSidebarAndNavigatorHidden] = React.useState(() => {
    return isFocusedMode || storage.get(storage.KEYS.focusModeEnabled, false)
  })

  // Auto-compact mode: shell width below mobile threshold hides sidebar/navigator
  // and switches to single-panel mode. Works in both webui (narrow viewport) and
  // desktop (narrow window or small screen).
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useContainerWidth(shellRef)
  const MOBILE_THRESHOLD = 768
  const isAutoCompact = shellWidth > 0 && shellWidth < MOBILE_THRESHOLD

  const effectiveSidebarAndNavigatorHidden = isSidebarAndNavigatorHidden || isAutoCompact

  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource, navigateToSession } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // Derived from focused panel's route — all panels are peers
  const navState = useNavigationState()

  const store = useStore()
  const panelStack = useAtomValue(panelStackAtom)
  const panelCount = useAtomValue(panelCountAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  // Navigate the focused panel to a session.
  // If the session is already open in another panel, focus that panel instead.
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const navigateToSessionInPanel = useCallback((sessionId: string) => {
    // Check if the session is already open in any panel — focus it instead of navigating
    const stack = store.get(panelStackAtom)
    for (const entry of stack) {
      if (parseSessionIdFromRoute(entry.route) === sessionId) {
        setFocusedPanel(entry.id)
        return
      }
    }

    // Not open in any panel — navigate() updates the focused panel
    navigateToSession(sessionId)
  }, [store, setFocusedPanel, navigateToSession])

  const sessionsContext = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      return {
        filter: navState.filter,
        sessionId: navState.details?.sessionId ?? null,
      }
    }
    return null
  }, [navState])

  const sessionFilter = sessionsContext?.filter ?? null

  // Board view replaces the session-list navigator with the full-width Kanban panel,
  // so the navigator (and its resize handle) collapse to zero width while it's active.
  const isBoardView = isSessionsNavigation(navState) && navState.viewMode === 'board'

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Derive automation filter from navigation state (only when in automations navigator)
  const automationFilter: AutomationFilter | null = isAutomationsNavigation(navState) ? navState.filter ?? null : null

  // Per-view filter storage: each session list view (allSessions, flagged, state:X, label:X, view:X)
  // has its own independent set of status and label filters.
  // Each filter entry stores a mode ('include' or 'exclude') for tri-state filtering.
  type FilterEntry = Record<string, FilterMode> // id → mode
  type ViewFiltersMap = Record<string, { statuses: FilterEntry, labels: FilterEntry, projects?: FilterEntry, groupingMode?: 'date' }>

  // Compute a stable key for the current chat filter view
  const sessionFilterKey = useMemo(() => {
    if (!sessionFilter) return null
    switch (sessionFilter.kind) {
      case 'allSessions': return 'allSessions'
      case 'flagged': return 'flagged'
      case 'archived': return 'archived'
      case 'state': return `state:${sessionFilter.stateId}`
      case 'label': return `label:${sessionFilter.labelId}`
      case 'view': return `view:${sessionFilter.viewId}`
      default: return 'allSessions'
    }
  }, [sessionFilter])

  const [viewFiltersMap, setViewFiltersMap] = React.useState<ViewFiltersMap>(() => {
    const saved = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {})
    // Backward compat: migrate old format (arrays) into new format (Record<string, FilterMode>)
    if (saved.allSessions && Array.isArray((saved.allSessions as any).statuses)) {
      // Old format: { statuses: string[], labels: string[] } → new: { statuses: Record, labels: Record }
      for (const key of Object.keys(saved)) {
        const entry = saved[key] as any
        if (Array.isArray(entry.statuses)) {
          const newStatuses: FilterEntry = {}
          for (const id of entry.statuses) newStatuses[id] = 'include'
          const newLabels: FilterEntry = {}
          for (const id of entry.labels) newLabels[id] = 'include'
          saved[key] = { statuses: newStatuses, labels: newLabels }
        }
      }
    }
    // Also migrate legacy global filters if no allSessions entry exists
    if (!saved.allSessions) {
      const oldStatuses = storage.get<SessionStatusId[]>(storage.KEYS.listFilter, [])
      const oldLabels = storage.get<string[]>(storage.KEYS.labelFilter, [])
      if (oldStatuses.length > 0 || oldLabels.length > 0) {
        const statuses: FilterEntry = {}
        for (const id of oldStatuses) statuses[id] = 'include'
        const labels: FilterEntry = {}
        for (const id of oldLabels) labels[id] = 'include'
        saved.allSessions = { statuses, labels }
      }
    }
    return sanitizeRemovedSessionFilters(saved)
  })

  // Derive current view's status filter as a Map<SessionStatusId, FilterMode>
  const listFilter = useMemo(() => new Map<SessionStatusId, FilterMode>(), [])

  // Derive current view's label filter as a Map<string, FilterMode>
  const labelFilter = useMemo(() => new Map<string, FilterMode>(), [])

  // Derive current view's project filter as a Map<projectId, FilterMode>
  const projectFilter = useMemo(() => {
    if (!sessionFilterKey) return new Map<string, FilterMode>()
    const entry = sanitizeSidebarProjectScope(viewFiltersMap[sessionFilterKey]?.projects)
    return new Map<string, FilterMode>(Object.entries(entry))
  }, [viewFiltersMap, sessionFilterKey])

  // Jump to All Sessions scoped to a task: replace the allSessions view's label filter
  // (and project filter, when the task is bound to one) with the task's scope, then open
  // the session. These are the SAME user-clearable filters the list-header chips edit —
  // clearing them afterwards works exactly like any hand-set filter. Mirrors
  // handleJumpToProjectSessions; used by kanban tile/subtask clicks and post-create.
  const handleJumpToTaskSessions = useCallback(
    (sessionId: string, scope: { labelId: string; projectId?: string }) => {
      setViewFiltersMap(prev => {
        const existing = prev['allSessions']
        return {
          ...prev,
          allSessions: {
            statuses: existing?.statuses ?? {},
            labels: {},
            projects: scope.projectId ? { [scope.projectId]: 'include' } : {},
            groupingMode: 'date',
          }
        }
      })
      navigate(routes.view.allSessions(sessionId))
    },
    []
  )

  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ sessionId: string | null; count: number; index: number; isHighlighting?: boolean }>({ sessionId: null, count: 0, index: 0 })

  // Callback for immediate match info updates from ChatDisplay
  // Memo guard prevents render feedback loops from identical updates
  const handleChatMatchInfoChange = React.useCallback((info: { sessionId: string | null; count: number; index: number; isHighlighting: boolean }) => {
    setChatMatchInfo(prev => {
      if (prev.sessionId === info.sessionId && prev.count === info.count && prev.index === info.index && prev.isHighlighting === info.isHighlighting) {
        return prev
      }
      return info
    })
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ sessionId: null, count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])

  // Reset search only when navigator or filter changes (not when selecting sessions)
  const navFilterKey = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      const filter = navState.filter
      return `chats:${filter.kind}:${filter.kind === 'state' ? filter.stateId : ''}`
    }
    return navState.navigator
  }, [navState])

  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Cmd+F to activate search
  useAction('app.search', () => setSearchActive(true))

  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.expandedFolders, [])
    return new Set(saved)
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  // Track which expandable sidebar items are collapsed
  // Labels are collapsed by default; user preference is persisted once toggled
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)
    if (saved !== null) return new Set(saved)
    return new Set()
  })
  const isExpanded = React.useCallback((id: string) => !collapsedItems.has(id), [collapsedItems])
  const toggleExpanded = React.useCallback((id: string) => {
    setCollapsedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Sources state (workspace-scoped)
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const activeWorkspaceIdRef = React.useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId
  // Sync sources to atom for NavigationContext auto-selection
  const setSourcesAtom = useSetAtom(sourcesAtom)
  React.useEffect(() => {
    setSourcesAtom(sources)
  }, [sources, setSourcesAtom])

  // Skills state (workspace-scoped)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  // Sync skills to atom for NavigationContext auto-selection
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])
  // Automations — state, handlers, loading, subscriptions
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Send to Workspace dialog state (driven by sendToWorkspaceAtom set from SessionMenu/BatchSessionMenu)
  const sendToWorkspaceIds = useAtomValue(sendToWorkspaceAtom)
  const setSendToWorkspaceIds = useSetAtom(sendToWorkspaceAtom)
  const handleTransferComplete = useCallback((targetWorkspaceId: string, _newSessionIds: string[]) => {
    onSelectWorkspace(targetWorkspaceId)
  }, [onSelectWorkspace])
  const {
    automations, automationTestResults,
    automationPendingDelete, pendingDeleteAutomation, setAutomationPendingDelete,
    handleTestAutomation, handleSimulateMatch, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, confirmDeleteAutomation,
    getAutomationHistory, handleReplayAutomation,
  } = useAutomations(activeWorkspaceId, navigateToSessionInPanel)

  const { projects } = useProjects(activeWorkspaceId)
  const projectMenuOptions = useMemo(
    () => projects.map(p => ({ id: p.config.id, slug: p.config.slug, name: p.config.name, color: p.config.color })),
    [projects],
  )
  const selectedProjectSlug = isProjectsNavigation(navState)
    ? navState.details?.projectSlug
    : undefined
  const selectedProjectId = useMemo(
    () => projectMenuOptions.find(project => project.slug === selectedProjectSlug)?.id,
    [projectMenuOptions, selectedProjectSlug],
  )
  const handleSessionProjectChange = useCallback(async (sessionId: string, projectId: string | null) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setProjectId', projectId })
    } catch (err) {
      console.error('[AppShell] Failed to update session project:', err)
      toast.error(t('toast.failedToUpdateProject'))
    }
  }, [t])

  // Whether local MCP servers are enabled (affects stdio source status)
  const [localMcpEnabled, setLocalMcpEnabled] = React.useState(true)

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (for localMcpEnabled and cyclablePermissionModes) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  // Reset UI state when workspace changes
  // This prevents stale search queries, focused items, and filter state from persisting
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    const previousWorkspaceId = previousWorkspaceRef.current

    // Clear transient UI state only on workspace SWITCH (not initial mount)
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)
    }

    // Load workspace-scoped state on BOTH initial mount AND workspace switch
    // This fixes CMD+R losing filters - previously only ran on workspace switch
    if (previousWorkspaceId !== activeWorkspaceId) {
      const newViewFilters = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {}, activeWorkspaceId)
      setViewFiltersMap(sanitizeRemovedSessionFilters(newViewFilters))

      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(newCollapsedItems !== null ? new Set(newCollapsedItems) : new Set())
    }

    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Load sources from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSources(activeWorkspaceId).then((loaded) => {
      setSources(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load sources:', err)
    })
  }, [activeWorkspaceId])

  // Subscribe to live source updates (when sources are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Handle session source selection changes
  const handleSessionSourcesChange = React.useCallback(async (sessionId: string, sourceSlugs: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setSources', sourceSlugs })
      // Session will emit a 'sources_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session sources:', err)
    }
  }, [])

  // Handle session label changes (add/remove via # menu or badge X)
  const handleSessionLabelsChange = React.useCallback(async (sessionId: string, labels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session labels:', err)
    }
  }, [])


  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs, isLoading: isLoadingStatuses } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }

    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Optimistic status order: immediately reflects drag-drop order while IPC propagates.
  // Cleared when statusConfigs changes (config watcher is source of truth).
  const [optimisticStatusOrder, setOptimisticStatusOrder] = React.useState<string[] | null>(null)

  // Clear optimistic state when the config watcher fires (statusConfigs changes)
  React.useEffect(() => {
    setOptimisticStatusOrder(null)
  }, [statusConfigs])

  // Derive effective todo states: apply optimistic reorder if active, otherwise use canonical order
  const effectiveSessionStatuses = React.useMemo(() => {
    if (!optimisticStatusOrder) return sessionStatuses
    // Reorder sessionStatuses array to match optimistic order
    const stateMap = new Map(sessionStatuses.map(s => [s.id, s]))
    const reordered: SessionStatus[] = []
    for (const id of optimisticStatusOrder) {
      const state = stateMap.get(id)
      if (state) reordered.push(state)
    }
    // Append any states not in the optimistic order (shouldn't happen, but defensive)
    for (const state of sessionStatuses) {
      if (!optimisticStatusOrder.includes(state.id)) reordered.push(state)
    }
    return reordered
  }, [sessionStatuses, optimisticStatusOrder])

  // Load labels from workspace config
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)
  const displayLabelConfigs = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  // Views: compiled once on config load, evaluated per session in list/chat
  const { evaluateSession: evaluateViews, viewConfigs } = useViews(activeWorkspace?.id || null)

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a source from the list (preserves current filter type)
  const handleSourceSelect = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    navigateToSource(source.config.slug)
  }, [activeWorkspaceId, navigateToSource])

  // Handle selecting a skill from the list
  const handleSkillSelect = React.useCallback((skill: LoadedSkill) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.skills(skill.slug))
  }, [activeWorkspaceId, navigate])

  // Handle selecting an automation from the list
  const handleAutomationSelect = React.useCallback((automationId: string) => {
    // Preserve current automation filter when selecting an automation
    const type = isAutomationsNavigation(navState) ? navState.filter?.automationType : undefined
    navigate(routes.view.automations({ automationId, type }))
  }, [navState, navigate])

  // Focus zone management
  const { focusZone, focusNextZone, focusPreviousZone } = useFocusContext()

  // Register focus zones
  const { zoneRef: sidebarRef, isFocused: sidebarFocused } = useFocusZone({ zoneId: 'sidebar' })

  // Global keyboard shortcuts using centralized action registry
  // Actions are defined in @/actions/definitions.ts

  // Zone navigation - explicit keyboard intent, always move DOM focus
  useAction('nav.focusSidebar', () => focusZone('sidebar', { intent: 'keyboard' }))
  useAction('nav.focusNavigator', () => focusZone('navigator', { intent: 'keyboard' }))
  useAction('nav.focusChat', () => focusZone('chat', { intent: 'keyboard' }))

  // Tab navigation between zones
  useAction('nav.nextZone', () => {
    focusNextZone()
  }, { enabled: () => !document.querySelector('[role="dialog"]') })

  // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
  // In multi-panel, targets the focused panel's session
  const effectiveSessionId = focusedSessionId ?? session.selected

  // Focus chat input for the target session only (multi-panel safe).
  const focusChatInputForSession = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return
    dispatchFocusInputEvent({ sessionId: targetSessionId })
  }, [])

  useAction('chat.cyclePermissionMode', () => {
    if (effectiveSessionId) {
      const currentOptions = contextValue.sessionOptions.get(effectiveSessionId)
      const currentMode = currentOptions?.permissionMode ?? 'ask'
      // Cycle through enabled permission modes
      const modes = enabledModes.length >= 2 ? enabledModes : ['safe', 'ask', 'allow-all'] as PermissionMode[]
      const currentIndex = modes.indexOf(currentMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      contextValue.onSessionOptionsChange(effectiveSessionId, { permissionMode: nextMode })
    }
  })

  const handleToggleSidebar = useCallback(() => {
    if (isSidebarAndNavigatorHidden) {
      setIsSidebarAndNavigatorHidden(false)
      return
    }
    setIsSidebarVisible(v => !v)
  }, [isSidebarAndNavigatorHidden])

  // Sidebar toggle (CMD+B)
  useAction('view.toggleSidebar', handleToggleSidebar)

  // Focus mode toggle (CMD+.) - hides both sidebars
  useAction('view.toggleFocusMode', () => setIsSidebarAndNavigatorHidden(v => !v))

  // Panel focus navigation (CMD+SHIFT+[ / ])
  const focusNextPanel = useSetAtom(focusNextPanelAtom)
  const focusPrevPanel = useSetAtom(focusPrevPanelAtom)
  useAction('panel.focusNext', focusNextPanel, { enabled: () => panelCount > 1 })
  useAction('panel.focusPrev', focusPrevPanel, { enabled: () => panelCount > 1 })

  // New chat
  useAction('app.newChat', () => handleNewChat())
  useAction('app.newChatInPanel', () => handleNewChat(true))

  // Settings
  useAction('app.settings', onOpenSettings)

  // Keyboard shortcuts
  useAction('app.keyboardShortcuts', onOpenKeyboardShortcuts)

  // New window
  useAction('app.newWindow', () => window.electronAPI.menuNewWindow())

  // Quit (note: also handled by native menu on macOS)
  useAction('app.quit', () => window.electronAPI.menuQuit())

  // History navigation
  useAction('nav.goBack', goBack)
  useAction('nav.goForward', goForward)

  // History navigation (arrow key alternatives)
  useAction('nav.goBackAlt', goBack)
  useAction('nav.goForwardAlt', goForward)

  // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
  useAction('chat.nextSearchMatch', () => chatDisplayRef.current?.goToNextMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })
  useAction('chat.prevSearchMatch', () => chatDisplayRef.current?.goToPrevMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })

  // ESC to stop processing - requires double-press within 1 second
  // First press shows warning overlay, second press interrupts
  // In multi-panel, targets the focused panel's session
  useAction('chat.stopProcessing', () => {
    if (effectiveSessionId) {
      const meta = sessionMetaMap.get(effectiveSessionId)
      if (meta?.isProcessing) {
        // handleEscapePress returns true on second press (within timeout)
        const shouldInterrupt = handleEscapePress()
        if (shouldInterrupt) {
          window.electronAPI.cancelProcessing(effectiveSessionId, false).catch(err => {
            console.error('[AppShell] Failed to cancel processing:', err)
          })
        }
      }
    }
  }, {
    // Only active when no overlay is open and session is processing
    // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
    enabled: () => {
      if (hasOpenOverlay()) return false
      if (!effectiveSessionId) return false
      const meta = sessionMetaMap.get(effectiveSessionId)
      return meta?.isProcessing ?? false
    }
  }, [effectiveSessionId, handleEscapePress])

  // Theme toggle (CMD+SHIFT+A)
  useAction('app.toggleTheme', () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'))

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Skip if a dialog or menu is open
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return
      }

      // Skip if there are no files in the clipboard
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return

      // Skip if the active element is an input/textarea/contenteditable (let it handle paste directly)
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }

      // Prevent default paste behavior
      e.preventDefault()

      // Dispatch custom event for FreeFormInput to handle (target focused session only)
      const filesArray = Array.from(files)
      const targetSessionId = focusedSessionId ?? session.selected
      if (!targetSessionId) return
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: { files: filesArray, sessionId: targetSessionId }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [focusedSessionId, session.selected])

  // Resize effect for sidebar, session list, browser host lane, and metadata right sidebar.
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing === 'sidebar') {
        const newWidth = Math.min(Math.max(e.clientX, 180), 320)
        setSidebarWidth(newWidth)
        if (resizeHandleRef.current) {
          const rect = resizeHandleRef.current.getBoundingClientRect()
          setSidebarHandleY(e.clientY - rect.top)
        }
      } else if (isResizing === 'session-list') {
        const offset = isSidebarVisible ? sidebarWidth : 0
        const newWidth = Math.min(Math.max(e.clientX - offset, 240), 480)
        setSessionListWidth(newWidth)
        if (sessionListHandleRef.current) {
          const rect = sessionListHandleRef.current.getBoundingClientRect()
          setSessionListHandleY(e.clientY - rect.top)
        }
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'sidebar') {
        storage.set(storage.KEYS.sidebarWidth, sidebarWidth)
        setSidebarHandleY(null)
      } else if (isResizing === 'session-list') {
        storage.set(storage.KEYS.sessionListWidth, sessionListWidth)
        setSessionListHandleY(null)
      }
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    isResizing,
    sidebarWidth,
    sessionListWidth,
    isSidebarVisible,
  ])

  // Spring transition config - shared between sidebar and header
  // Critical damping (no bounce): damping = 2 * sqrt(stiffness * mass)
  const springTransition = {
    type: "spring" as const,
    stiffness: 600,
    damping: 49,
  }

  // Use session metadata from Jotai atom (lightweight, no messages)
  // This prevents closures from retaining full message arrays
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const setSessionMetaMap = useSetAtom(sessionMetaMapAtom)

  const hasPendingPrompt = React.useCallback((sessionId: string) => {
    return (pendingPermissions.get(sessionId)?.length ?? 0) > 0
  }, [pendingPermissions])

  // Workspace-level unread indicators (needed for workspace selectors across all workspaces)
  const [workspaceUnreadMap, setWorkspaceUnreadMap] = useState<Record<string, boolean>>({})

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: bundled, global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionWorkingDirectory = session.selected
    ? sessionMetaMap.get(session.selected)?.workingDirectory
    : undefined
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    let cancelled = false
    let loadGeneration = 0

    // Skill broadcasts are workspace-scoped, while project Skills depend on
    // the active session's working directory. Re-read the correctly scoped
    // list instead of trusting a payload produced for another session.
    const reloadSkills = async () => {
      const generation = ++loadGeneration
      try {
        const loaded = await window.electronAPI.getSkills(
          activeWorkspaceId,
          activeSessionWorkingDirectory,
        )
        if (!cancelled && generation === loadGeneration) setSkills(loaded || [])
      } catch (err) {
        if (!cancelled && generation === loadGeneration) {
          console.error('[Chat] Failed to load skills:', err)
        }
      }
    }

    const cleanup = window.electronAPI.onSkillsChanged((workspaceId) => {
      if (workspaceId === activeWorkspaceId) void reloadSkills()
    })

    void reloadSkills()

    return () => {
      cancelled = true
      cleanup()
    }
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Completion is announced only after the resource has been re-read into its
  // owning list. This prevents a success toast from racing a delayed watcher.
  React.useEffect(() => {
    const handleCreationCompleted = (event: Event) => {
      const detail = (event as CustomEvent<CreationCompletedEventDetail>).detail
      if (!detail || detail.workspaceId !== activeWorkspaceIdRef.current) return
      if (detail.kind === 'source') {
        detail.waitUntil(window.electronAPI.getSources(detail.workspaceId).then((loaded) => {
          const refreshed = loaded || []
          if (!refreshed.some((source) => source.config.slug === detail.id)) {
            throw new Error(`Created source "${detail.id}" was not visible after refresh.`)
          }
          if (activeWorkspaceIdRef.current === detail.workspaceId) {
            clearSourceIconCaches()
            setSources(refreshed)
          }
        }))
      } else if (detail.kind === 'skill') {
        detail.waitUntil(window.electronAPI.getSkills(
          detail.workspaceId,
          activeSessionWorkingDirectory,
        ).then((loaded) => {
          const refreshed = loaded || []
          if (!refreshed.some((skill) => skill.slug === detail.id)) {
            throw new Error(`Created skill "${detail.id}" was not visible after refresh.`)
          }
          if (activeWorkspaceIdRef.current === detail.workspaceId) setSkills(refreshed)
        }))
      }
    }
    window.addEventListener(CREATION_COMPLETED_EVENT, handleCreationCompleted)
    return () => window.removeEventListener(CREATION_COMPLETED_EVENT, handleCreationCompleted)
  }, [activeSessionWorkingDirectory])

  // Filter session metadata by active workspace
  // Also exclude hidden sessions (mini-agent sessions) from all counts and lists
  // For remote workspaces, sessions have the remote workspace ID (not the local one),
  // so we match against both the local and remote workspace IDs.
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    if (!activeWorkspaceId) return metas.filter(isOrdinarySessionVisible)
    return metas.filter(s =>
      isOrdinarySessionVisible(s) && (s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId])

  // Classification metadata is retained for backward compatibility, but it no
  // longer removes sessions from the ordinary list (#180).
  const activeSessionMetas = useMemo(() => {
    return workspaceSessionMetas
  }, [workspaceSessionMetas])

  // Project children are implemented as an All Sessions secondary filter, but
  // NavigationContext cannot see that local filter when it auto-selects a chat.
  // Select a project-bound session explicitly, or suppress auto-selection when
  // the project is empty so an unrelated global chat cannot remain on the right.
  const handleJumpToProjectSessions = useCallback((projectId: string) => {
    setViewFiltersMap(prev => ({
      ...prev,
      allSessions: {
        statuses: {},
        labels: {},
        projects: { [projectId]: 'include' },
        groupingMode: 'date',
      },
    }))

    const hasOtherSecondaryFilters = false
    const firstProjectSessionId = resolveProjectNavigationSessionId(
      activeSessionMetas,
      projectId,
      hasOtherSecondaryFilters,
    )
    navigate(
      routes.view.allSessions(firstProjectSessionId ?? undefined),
      firstProjectSessionId ? undefined : { skipAutoSelect: true },
    )
  }, [activeSessionMetas])

  const refreshWorkspaceUnreadMap = useCallback(async () => {
    try {
      const summary = await window.electronAPI.getUnreadSummary()
      const next: Record<string, boolean> = {}

      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }

      setWorkspaceUnreadMap(next)
    } catch (error) {
      console.error('[AppShell] Failed to refresh workspace unread indicators:', error)
    }
  }, [workspaces])

  // Initial + workspace-list refresh
  useEffect(() => {
    void refreshWorkspaceUnreadMap()
  }, [refreshWorkspaceUnreadMap])

  // Keep active workspace unread indicator in sync with live metadata updates
  useEffect(() => {
    if (!activeWorkspaceId) return
    const activeHasUnread = activeSessionMetas.some((session) => !!session.hasUnread)
    setWorkspaceUnreadMap((prev) => ({ ...prev, [activeWorkspaceId]: activeHasUnread }))
  }, [activeWorkspaceId, activeSessionMetas])

  // Keep cross-workspace indicators in sync with global unread updates from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onUnreadSummaryChanged((summary) => {
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    })

    return cleanup
  }, [workspaces])

  // Count sources by type for the Sources dropdown subcategories
  const sourceTypeCounts = useMemo(() => {
    const counts = { api: 0, mcp: 0, local: 0 }
    for (const source of sources) {
      const t = source.config.type
      if (t === 'api' || t === 'mcp' || t === 'local') {
        counts[t]++
      }
    }
    return counts
  }, [sources])

  // Count automations by type for the Automations dropdown subcategories
  const automationTypeCounts = useMemo(() => {
    const counts = { scheduled: 0, event: 0, agentic: 0 }
    for (const automation of automations) {
      if (automation.event === 'SchedulerTick') counts.scheduled++
      else if ((APP_EVENTS as string[]).includes(automation.event)) counts.event++
      else if ((AGENT_EVENTS as string[]).includes(automation.event)) counts.agentic++
    }
    return counts
  }, [automations])

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    // When in sources mode, return empty (no sessions to show)
    if (!sessionFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (sessionFilter.kind) {
      case 'allSessions':
        // Ordinary sessions include legacy archived/classified conversations.
        result = workspaceSessionMetas
        break
      case 'flagged':
        result = workspaceSessionMetas
        break
      case 'archived':
        // Legacy classification routes are aliases of ordinary sessions.
        result = workspaceSessionMetas
        break
      case 'state':
        result = workspaceSessionMetas
        break
      case 'label': {
        result = workspaceSessionMetas
        break
      }
      case 'view': {
        // Filter by view: __all__ shows any session matched by any view,
        // otherwise filter to the specific view (excludes archived)
        result = activeSessionMetas.filter(s => {
          const matched = evaluateViews(s)
          if (sessionFilter.viewId === '__all__') {
            return matched.length > 0
          }
          return matched.some(v => v.id === sessionFilter.viewId)
        })
        break
      }
      default:
        result = activeSessionMetas
    }

    if (projectFilter.size > 0) {
      result = filterSessionsByProject(result, projectFilter)
    }

    return result
  }, [workspaceSessionMetas, activeSessionMetas, sessionFilter, projectFilter])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  // Extend context value with local overrides (wrapped onDeleteSession, sources, skills, labels, enabledModes, rightSidebarOpenButton, effectiveSessionStatuses)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    enabledSources: sources,
    skills,
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    sessionStatuses: effectiveSessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
    onJumpToTaskSessions: handleJumpToTaskSessions,
    orchestrationProjectId: resolveNewSessionParams(listFilter, labelFilter, projectFilter, selectedProjectId)?.project ?? null,
    rightSidebarButton: null,
    isCompactMode: isAutoCompact,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
    onTestAutomation: handleTestAutomation,
    onSimulateMatchAutomation: handleSimulateMatch,
    onToggleAutomation: handleToggleAutomation,
    onDuplicateAutomation: handleDuplicateAutomation,
    onDeleteAutomation: handleDeleteAutomation,
    automationTestResults,
    getAutomationHistory,
    onReplayAutomation: handleReplayAutomation,
  }), [contextValue, handleDeleteSession, sources, skills, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, enabledModes, effectiveSessionStatuses, handleSessionSourcesChange, handleJumpToTaskSessions, listFilter, labelFilter, projectFilter, selectedProjectId, isAutoCompact, searchActive, searchQuery, handleChatMatchInfoChange, handleTestAutomation, handleSimulateMatch, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, automationTestResults, getAutomationHistory, handleReplayAutomation])

  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

  // Persist focus mode state to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.focusModeEnabled, isSidebarAndNavigatorHidden)
  }, [isSidebarAndNavigatorHidden])

  // Listen for focus mode toggle from menu (View → Focus Mode)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      setIsSidebarAndNavigatorHidden(v => !v)
    })
    return cleanup
  }, [])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      handleToggleSidebar()
    })
    return cleanup
  }, [handleToggleSidebar])

  // Persist per-view filter map to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(
      storage.KEYS.viewFilters,
      sanitizeRemovedSessionFilters(viewFiltersMap),
      activeWorkspaceId,
    )
  }, [viewFiltersMap, activeWorkspaceId])

  // Persist sidebar section collapsed states (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)
  }, [collapsedItems, activeWorkspaceId])

  const handleAllSessionsClick = useCallback(() => {
    // Project children share the allSessions route and are represented by a
    // secondary project filter. Explicitly selecting the parent must clear
    // that scope; otherwise both rows stay highlighted and the list remains
    // restricted to the previously selected project (#165).
    setViewFiltersMap(prev => {
      const existing = prev['allSessions']
      if (!existing || Object.keys(existing.projects ?? {}).length === 0) return prev
      return {
        ...prev,
        allSessions: clearProjectFilter(existing),
      }
    })
    navigate(routes.view.allSessions())
  }, [])

  // Handler for sources view (all sources)
  const handleSourcesClick = useCallback(() => {
    navigate(routes.view.sources())
  }, [])

  // Handlers for source type filter views (subcategories in Sources dropdown)
  const handleSourcesApiClick = useCallback(() => {
    navigate(routes.view.sourcesApi())
  }, [])

  const handleSourcesMcpClick = useCallback(() => {
    navigate(routes.view.sourcesMcp())
  }, [])

  const handleSourcesLocalClick = useCallback(() => {
    navigate(routes.view.sourcesLocal())
  }, [])

  // Handler for skills view
  const handleSkillsClick = useCallback(() => {
    navigate(routes.view.skills())
  }, [])

  // Handlers for automations view
  const handleAutomationsClick = useCallback(() => {
    navigate(routes.view.automations())
  }, [])

  // Handler for projects view
  const handleProjectsClick = useCallback(() => {
    navigate(routes.view.projects())
  }, [])

  const handleAutomationsScheduledClick = useCallback(() => {
    navigate(routes.view.automationsScheduled())
  }, [])

  const handleAutomationsEventClick = useCallback(() => {
    navigate(routes.view.automationsEvent())
  }, [])

  const handleAutomationsAgenticClick = useCallback(() => {
    navigate(routes.view.automationsAgentic())
  }, [])

  // Handler for settings view. With no arg → bare `settings` route (navigator-only
  // in compact mode, App fallback on desktop). With an arg → `settings/<subpage>`.
  const handleSettingsClick = useCallback((subpage?: SettingsSubpage) => {
    navigate(routes.view.settings(subpage))
  }, [])

  // ============================================================================
  // EDIT POPOVER STATE
  // ============================================================================
  // State to control which EditPopover is open (triggered from context menus).
  // We use controlled popovers instead of deep links so the user can type
  // their request in the popover UI before opening a new chat window.
  // add-source variants: add-source (generic), add-source-api, add-source-mcp, add-source-local
  type ControlledEditPopoverKey = 'statuses' | 'labels' | 'views' | 'add-source' | 'add-source-api' | 'add-source-mcp' | 'add-source-local' | 'add-skill' | 'add-label' | 'add-automation' | 'add-project'
  const [editPopoverOpen, setEditPopoverOpen] = useState<ControlledEditPopoverKey | null>(null)
  const [copySkillsFromOpen, setCopySkillsFromOpen] = useState(false)
  const [copySourcesFromOpen, setCopySourcesFromOpen] = useState(false)
  const [mcpFileImportOpen, setMcpFileImportOpen] = useState(false)
  const [skillFileDropOpen, setSkillFileDropOpen] = useState(false)
  const [skillFilePreparing, setSkillFilePreparing] = useState(false)
  const skillFileInputRef = useRef<HTMLInputElement>(null)
  const skillFileImporting = useRef(false)
  const skillFileCancelCleanupRef = useRef<(() => void) | null>(null)
  const skillFileImportTriggerRef = useRef<HTMLElement | null>(null)
  const [preparedSkillFileImport, setPreparedSkillFileImport] = useState<{
    workspaceId: string
    value: PreparedSkillFileImport
  } | null>(null)

  const clearSkillFileCancelListener = useCallback(() => {
    skillFileCancelCleanupRef.current?.()
    skillFileCancelCleanupRef.current = null
  }, [])

  const finishSkillFileImport = useCallback(() => {
    clearSkillFileCancelListener()
    setSkillFileDropOpen(false)
    setSkillFilePreparing(false)
    setPreparedSkillFileImport(null)
    releaseSkillFilePicker(skillFileImporting)
    requestAnimationFrame(() => skillFileImportTriggerRef.current?.focus())
  }, [clearSkillFileCancelListener])

  const handleImportSkillFromFile = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!activeWorkspaceId || skillFileImporting.current) return
    skillFileImportTriggerRef.current = event.currentTarget
    setSkillFileDropOpen(true)
  }, [activeWorkspaceId])

  const cancelSkillFilePicker = useCallback(() => {
    clearSkillFileCancelListener()
    setSkillFilePreparing(false)
    releaseSkillFilePicker(skillFileImporting)
  }, [clearSkillFileCancelListener])

  const handleChooseSkillFile = useCallback(() => {
    if (!activeWorkspaceId || !skillFileInputRef.current || skillFileImporting.current) return
    clearSkillFileCancelListener()
    skillFileCancelCleanupRef.current = listenForSkillFilePickerCancel(
      skillFileInputRef.current,
      cancelSkillFilePicker,
    )
    setSkillFilePreparing(true)
    try {
      openSkillFilePicker(skillFileInputRef.current, skillFileImporting)
    } catch (error) {
      cancelSkillFilePicker()
      toast.error(t('fileImport.skillFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [activeWorkspaceId, cancelSkillFilePicker, clearSkillFileCancelListener, t])

  const handleSkillImportFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    clearSkillFileCancelListener()
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeWorkspaceId) {
      cancelSkillFilePicker()
      return
    }

    try {
      const value = await prepareSkillFileImport(window.electronAPI, activeWorkspaceId, file)
      setSkillFileDropOpen(false)
      setPreparedSkillFileImport({ workspaceId: activeWorkspaceId, value })
    } catch (error) {
      cancelSkillFilePicker()
      toast.error(t('fileImport.skillFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [activeWorkspaceId, cancelSkillFilePicker, clearSkillFileCancelListener, t])

  const handleImportSkillFromDrop = useCallback((files: File[]) => {
    if (!activeWorkspaceId || skillFileImporting.current) return

    let file: File
    try {
      file = getDroppedSkillImportFile(files)
    } catch (error) {
      toast.error(t('fileImport.skillFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (!skillFileDropOpen) skillFileImportTriggerRef.current = null
    clearSkillFileCancelListener()
    skillFileImporting.current = true
    setSkillFilePreparing(true)
    void prepareSkillFileImport(window.electronAPI, activeWorkspaceId, file)
      .then(value => {
        setSkillFileDropOpen(false)
        setPreparedSkillFileImport({ workspaceId: activeWorkspaceId, value })
      })
      .catch(error => {
        setSkillFilePreparing(false)
        releaseSkillFilePicker(skillFileImporting)
        toast.error(t('fileImport.skillFailed'), {
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }, [activeWorkspaceId, clearSkillFileCancelListener, skillFileDropOpen, t])

  useEffect(() => {
    if (
      preparedSkillFileImport
      && preparedSkillFileImport.workspaceId !== activeWorkspaceId
    ) {
      finishSkillFileImport()
    }
  }, [activeWorkspaceId, finishSkillFileImport, preparedSkillFileImport])

  // Stores the Y position of the last right-clicked sidebar item so the EditPopover
  // appears near it rather than at a fixed location. Updated synchronously before
  // the setTimeout that opens the popover, ensuring the ref is set before render.
  const editPopoverAnchorY = useRef<number>(120)
  // Tracks which label was right-clicked when opening label EditPopovers,
  // so the agent knows the target for commands like "make this red" or "add below this"
  const editLabelTargetId = useRef<string | undefined>(undefined)

  // Stores the trigger element (button) so we can keep it highlighted while the
  // EditPopover is open (after Radix removes data-state="open" on context menu close).
  const editPopoverTriggerRef = useRef<Element | null>(null)

  // Captures the bounding rect of the currently-open context menu trigger (the button).
  // Radix sets data-state="open" on the button (via ContextMenuTrigger asChild)
  // while the menu is visible, so we can locate it in the DOM at click time.
  const captureContextMenuPosition = useCallback(() => {
    const trigger = document.querySelector('.group\\/section > [data-state="open"]')
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      editPopoverAnchorY.current = rect.top
      editPopoverTriggerRef.current = trigger
    }
  }, [])

  // Sync data-edit-active attribute on the trigger element with EditPopover open state.
  // This keeps the sidebar item visually highlighted while the popover is shown,
  // since Radix's data-state="open" disappears when the context menu closes.
  useEffect(() => {
    const el = editPopoverTriggerRef.current
    if (!el) return
    if (editPopoverOpen) {
      el.setAttribute('data-edit-active', 'true')
    } else {
      el.removeAttribute('data-edit-active')
      editPopoverTriggerRef.current = null
    }
  }, [editPopoverOpen])

  // Handler for "Add Source" context menu action
  // Opens the EditPopover for adding a new source
  // Optional sourceType param allows filter-aware context (from subcategory menus or filtered views)
  const openAddSource = useCallback((sourceType?: 'api' | 'mcp' | 'local') => {
    captureContextMenuPosition()
    const key = sourceType ? `add-source-${sourceType}` as const : 'add-source' as const
    setTimeout(() => setEditPopoverOpen(key), 50)
  }, [captureContextMenuPosition])

  // Handler for "Add Skill" context menu action
  // Opens the EditPopover for adding a new skill
  const openAddSkill = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('add-skill'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Add Automation" context menu action
  // Opens the EditPopover for adding a new automation
  const openAddAutomation = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('add-automation'), 50)
  }, [captureContextMenuPosition])

  const reopenCreationJob = useCallback((contextKey: string) => {
    const supportedKeys: ControlledEditPopoverKey[] = [
      'add-source',
      'add-source-api',
      'add-source-mcp',
      'add-source-local',
      'add-skill',
      'add-automation',
    ]
    if (!supportedKeys.includes(contextKey as ControlledEditPopoverKey)) return
    editPopoverAnchorY.current = 52
    setEditPopoverOpen(contextKey as ControlledEditPopoverKey)
  }, [])

  const openCreationResult = useCallback((job: CreationJob, resultId: string) => {
    if (job.kind === 'source') {
      navigateToSource(resultId)
      return
    }
    if (job.kind === 'skill') {
      navigate(routes.view.skills(resultId))
      return
    }
    navigate(routes.view.automations({ automationId: resultId }))
  }, [navigate, navigateToSource])

  // Handler for "Add Project" context menu action — creates a project directly
  // Open the "Create Project" dialog so the user can provide a name up front.
  // The previous flow auto-created with the default name and produced ugly
  // permanent slugs (new-project, new-project-1, …).
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)
  const openAddProject = useCallback(() => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(true)
  }, [activeWorkspace?.id])
  const handleCreateProjectSubmit = useCallback(async (name: string) => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(false)
    try {
      const project = await window.electronAPI.createProject(activeWorkspace.id, { name })
      navigate(routes.view.projects(project.slug))
    } catch (err) {
      console.error('[AppShell] Failed to create project:', err)
      toast.error(t('projectsList.createFailed'))
    }
  }, [activeWorkspace?.id, navigate, t])

  /**
   * Resolve the current project's explicit context first, then fall back to
   * the "inherit sole active filter" rule for session-list views. Only
   * include-mode filters are candidates — an excluded status/label/project must
   * never be inherited (#970). See resolveNewSessionParams.
   */
  const resolveNewSessionCreationParams = useCallback(
    () => resolveNewSessionParams(listFilter, labelFilter, projectFilter, selectedProjectId),
    [listFilter, labelFilter, projectFilter, selectedProjectId],
  )

  // Create a new chat and select it
  const handleNewChat = useCallback((newPanel: boolean = false) => {
    if (!activeWorkspace) return

    // A deep-linked project can render before the projects query completes.
    // Never turn that transient state into an unbound session; the user can
    // retry once the project metadata has loaded.
    if (selectedProjectSlug && !selectedProjectId) {
      toast.error(t('projectInfo.notFound'))
      return
    }

    // Exit search mode and switch to All Sessions
    setSearchActive(false)
    setSearchQuery('')

    // Inherit sole-active filter into the new session when unambiguous.
    const inherited = resolveNewSessionCreationParams()

    // Delegate to NavigationContext which handles session creation
    navigate(
      routes.action.newSession(inherited ?? undefined),
      newPanel ? { newPanel: true, targetLaneId: 'main' } : undefined
    )

    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone, resolveNewSessionCreationParams, selectedProjectId, selectedProjectSlug, t])

  // Delete Source - simplified since agents system is removed
  const handleDeleteSource = useCallback(async (sourceSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceSlug)
      toast.success(t('toast.deletedSource'))
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error(t('toast.failedToDeleteSource'))
    }
  }, [activeWorkspace])

  // Delete Skill
  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(t('toast.deletedSkill', { slug: skillSlug }))
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error(t('toast.failedToDeleteSkill'))
    }
  }, [activeWorkspace])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat()
  }, [menuNewChatTrigger, handleNewChat])

  // Unified sidebar items: nav buttons only (agents system removed)
  type SidebarItem = {
    id: string
    type: 'nav'
    action?: () => void
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    // Classification entries were removed in #180. Keep keyboard navigation in
    // the same order as the visible #181 sidebar.
    result.push({ id: 'nav:allSessions', type: 'nav', action: handleAllSessionsClick })
    result.push({ id: 'nav:projects', type: 'nav', action: handleProjectsClick })
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })
    result.push({ id: 'nav:automations', type: 'nav', action: handleAutomationsClick })
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick() })

    return result
  }, [handleAllSessionsClick, handleProjectsClick, handleSourcesClick, handleSkillsClick, handleAutomationsClick, handleSettingsClick])

  // Toggle folder expanded state
  const handleToggleFolder = React.useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Get props for any sidebar item (unified roving tabindex pattern)
  const getSidebarItemProps = React.useCallback((id: string) => ({
    tabIndex: focusedSidebarItemId === id ? 0 : -1,
    'data-focused': focusedSidebarItemId === id,
    ref: (el: HTMLElement | null) => {
      if (el) {
        sidebarItemRefs.current.set(id, el)
      } else {
        sidebarItemRefs.current.delete(id)
      }
    },
  }), [focusedSidebarItemId])

  // Unified sidebar keyboard navigation
  const handleSidebarKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!sidebarFocused || unifiedSidebarItems.length === 0) return

    const currentIndex = unifiedSidebarItems.findIndex(item => item.id === focusedSidebarItemId)
    const currentItem = currentIndex >= 0 ? unifiedSidebarItems[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIndex = currentIndex < unifiedSidebarItems.length - 1 ? currentIndex + 1 : 0
        const nextItem = unifiedSidebarItems[nextIndex]
        setFocusedSidebarItemId(nextItem.id)
        sidebarItemRefs.current.get(nextItem.id)?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : unifiedSidebarItems.length - 1
        const prevItem = unifiedSidebarItems[prevIndex]
        setFocusedSidebarItemId(prevItem.id)
        sidebarItemRefs.current.get(prevItem.id)?.focus()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        // At boundary - do nothing (Left doesn't change zones from sidebar)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        // Move to next zone (navigator) - keyboard navigation
        focusZone('navigator', { intent: 'keyboard' })
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (currentItem?.type === 'nav' && currentItem.action) {
          currentItem.action()
        }
        break
      }
      case 'Home': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const firstItem = unifiedSidebarItems[0]
          setFocusedSidebarItemId(firstItem.id)
          sidebarItemRefs.current.get(firstItem.id)?.focus()
        }
        break
      }
      case 'End': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const lastItem = unifiedSidebarItems[unifiedSidebarItems.length - 1]
          setFocusedSidebarItemId(lastItem.id)
          sidebarItemRefs.current.get(lastItem.id)?.focus()
        }
        break
      }
    }
  }, [sidebarFocused, unifiedSidebarItems, focusedSidebarItemId, focusZone])

  // Focus sidebar item when sidebar zone gains focus
  React.useEffect(() => {
    if (sidebarFocused && unifiedSidebarItems.length > 0) {
      // Set focused item if not already set
      const itemId = focusedSidebarItemId || unifiedSidebarItems[0].id
      if (!focusedSidebarItemId) {
        setFocusedSidebarItemId(itemId)
      }
      // Actually focus the DOM element
      requestAnimationFrame(() => {
        sidebarItemRefs.current.get(itemId)?.focus()
      })
    }
  }, [sidebarFocused, focusedSidebarItemId, unifiedSidebarItems])

  // Get title based on navigation state
  const listTitle = React.useMemo(() => {
    // Sources navigator
    if (isSourcesNavigation(navState)) {
      return t("sidebar.sources")
    }

    // Skills navigator
    if (isSkillsNavigation(navState)) {
      return t("sidebar.allSkills")
    }

    // Projects navigator
    if (isProjectsNavigation(navState)) {
      return t("sidebar.allProjects")
    }

    // Automations navigator
    if (isAutomationsNavigation(navState)) {
      if (!automationFilter) return t("sidebar.allAutomations")
      switch (automationFilter.automationType) {
        case 'scheduled': return t("sidebar.scheduled")
        case 'event': return t("sidebar.eventBased")
        case 'agentic': return t("sidebar.agentEvents")
        default: return t("sidebar.allAutomations")
      }
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return t("sidebar.settings")

    // Sessions navigator - use sessionFilter
    if (!sessionFilter) return t("sidebar.allSessions")

    switch (sessionFilter.kind) {
      case 'allSessions':
        return getIncludedProjectName(projectFilter, projects) ?? t("sidebar.allSessions")
      case 'flagged':
        return t("sidebar.allSessions")
      case 'state': {
        return t("sidebar.allSessions")
      }
      case 'label':
        return t("sidebar.allSessions")
      case 'view':
        return sessionFilter.viewId === '__all__' ? t("sidebar.views") : viewConfigs.find(v => v.id === sessionFilter.viewId)?.name || t("sidebar.views")
      default:
        return t("sidebar.allSessions")
    }
  }, [navState, t, sessionFilter, automationFilter, viewConfigs, projectFilter, projects])

  return (
    <AppShellProvider value={appShellContextValue}>
        {/* === TOP BAR === */}
        <CreationJobsHost
          workspaceId={activeWorkspaceId}
          onReopen={reopenCreationJob}
          onOpenResult={openCreationResult}
        />
        <TopBar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          workspaceUnreadMap={workspaceUnreadMap}
          onWorkspaceCreated={() => onRefreshWorkspaces?.()}
          onWorkspaceRemoved={() => onRefreshWorkspaces?.()}
          activeSessionId={effectiveSessionId}
          onNewChat={() => handleNewChat()}
          onNewWindow={() => window.electronAPI.menuNewWindow()}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={handleSettingsClick}
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onToggleSidebar={handleToggleSidebar}
          onToggleFocusMode={() => setIsSidebarAndNavigatorHidden(prev => !prev)}
          isCompact={isAutoCompact}
        />

      {/* === OUTER LAYOUT: Unified Panel Stack | Right Sidebar === */}
      <div
        ref={shellRef}
        className="flex items-stretch relative"
        style={{
          height: '100%',
          paddingRight: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingBottom: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingLeft: 0,
          gap: PANEL_GAP,
        }}
      >
        <PanelStackContainer
          sidebarSlot={
            <div
              ref={sidebarRef}
              style={{ width: sidebarWidth }}
              className="h-full font-sans relative"
              data-focus-zone="sidebar"
              tabIndex={sidebarFocused ? 0 : -1}
              onKeyDown={handleSidebarKeyDown}
            >
            <div className="flex h-full flex-col select-none">
              {/* Sidebar Top Section */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* New Session Button - Gmail-style, with context menu for "Open in New Window" */}
                <div className="px-2 pb-2 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <ContextMenu modal={true}>
                          <ContextMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              onClick={(e) => handleNewChat(e.metaKey || e.ctrlKey)}
                              className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background"
                              data-tutorial="new-chat-button"
                            >
                              <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />
                              {t("session.newSession")}
                            </Button>
                          </ContextMenuTrigger>
                          <StyledContextMenuContent>
                            <ContextMenuProvider>
                              <SidebarMenu type="newSession" />
                            </ContextMenuProvider>
                          </StyledContextMenuContent>
                        </ContextMenu>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">{newChatHotkey}</TooltipContent>
                  </Tooltip>
                </div>
                {/* Primary Nav: Ordinary Sessions, Projects, Sources, Skills, Settings */}
                {/* pb-4 provides clearance so the last item scrolls above the mask-fade-bottom gradient */}
                <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pb-4">
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={prepareOrdinarySessionSidebarLinks([
                    {
                      id: "nav:allSessions",
                      title: t("sidebar.allSessions"),
                      label: String(workspaceSessionMetas.length),
                      icon: Inbox,
                      // Project children reuse the allSessions route, so an
                      // included project owns the active state instead of the
                      // parent row (#165).
                      variant: (sessionFilter?.kind === 'allSessions' && !hasIncludedProjectFilter(projectFilter)) ? "default" : "ghost",
                      onClick: handleAllSessionsClick,
                      contextMenu: {
                        type: 'allSessions',
                        onMarkAllRead: () => {
                          if (!activeWorkspaceId) return
                          // Optimistic: clear hasUnread on all workspace session metas
                          setSessionMetaMap(prev => {
                            const next = new Map(prev)
                            for (const [id, meta] of next) {
                              if (meta.workspaceId === activeWorkspaceId && meta.hasUnread) {
                                next.set(id, { ...meta, hasUnread: false })
                              }
                            }
                            return next
                          })
                          window.electronAPI.markAllSessionsRead(activeWorkspaceId)
                        },
                      },
                    },
                    { id: "separator:chats-sources", type: "separator" },
                    // --- Sources & Skills Section ---
                    {
                      id: "nav:sources",
                      title: t("sidebar.sources"),
                      label: String(sources.length),
                      icon: DatabaseZap,
                      variant: (isSourcesNavigation(navState) && !sourceFilter) ? "default" : "ghost",
                      onClick: handleSourcesClick,
                      dataTutorial: "sources-nav",
                      expandable: true,
                      expanded: isExpanded('nav:sources'),
                      onToggle: () => toggleExpanded('nav:sources'),
                      contextMenu: {
                        type: 'sources',
                        onAddSource: () => openAddSource(),
                      },
                      items: [
                        {
                          id: "nav:sources:api",
                          title: t("sidebar.apis"),
                          label: String(sourceTypeCounts.api),
                          icon: Globe,
                          variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'api') ? "default" : "ghost",
                          onClick: handleSourcesApiClick,
                          contextMenu: {
                            type: 'sources' as const,
                            onAddSource: () => openAddSource('api'),
                            sourceType: 'api',
                          },
                        },
                        {
                          id: "nav:sources:mcp",
                          title: t("sidebar.mcps"),
                          label: String(sourceTypeCounts.mcp),
                          icon: <McpIcon className="h-3.5 w-3.5" />,
                          variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'mcp') ? "default" : "ghost",
                          onClick: handleSourcesMcpClick,
                          contextMenu: {
                            type: 'sources' as const,
                            onAddSource: () => openAddSource('mcp'),
                            sourceType: 'mcp',
                          },
                        },
                        {
                          id: "nav:sources:local",
                          title: t("sidebar.localFolders"),
                          label: String(sourceTypeCounts.local),
                          icon: FolderOpen,
                          variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'local') ? "default" : "ghost",
                          onClick: handleSourcesLocalClick,
                          contextMenu: {
                            type: 'sources' as const,
                            onAddSource: () => openAddSource('local'),
                            sourceType: 'local',
                          },
                        },
                      ],
                    },
                    {
                      id: "nav:skills",
                      title: t("sidebar.skills"),
                      label: String(skills.length),
                      icon: Sparkles,
                      variant: isSkillsNavigation(navState) ? "default" : "ghost",
                      onClick: handleSkillsClick,
                      contextMenu: {
                        type: 'skills',
                        onAddSkill: openAddSkill,
                      },
                    },
                    {
                      id: "nav:projects",
                      title: t("sidebar.projects"),
                      label: String(projects.length),
                      icon: FolderKanban,
                      // Highlight only when on Projects view itself, not when a child is "active" (jumped-to filter)
                      variant: isProjectsNavigation(navState) ? "default" : "ghost",
                      onClick: handleProjectsClick,
                      expandable: projects.length > 0,
                      expanded: isExpanded('nav:projects'),
                      onToggle: () => toggleExpanded('nav:projects'),
                      contextMenu: {
                        type: 'projects' as const,
                        onAddProject: openAddProject,
                      },
                      items: projects.map(p => ({
                        id: `nav:projects:${p.config.id}`,
                        title: p.config.name,
                        icon: FolderKanban,
                        // Highlight when on allSessions view AND filter includes this project (the jump-to state)
                        variant: (sessionFilter?.kind === 'allSessions' && projectFilter.get(p.config.id) === 'include') ? "default" as const : "ghost" as const,
                        onClick: () => handleJumpToProjectSessions(p.config.id),
                      })),
                    },
                    {
                      id: "nav:automations",
                      title: t("sidebar.automations"),
                      label: String(automations.length),
                      icon: Webhook,
                      variant: (isAutomationsNavigation(navState) && !automationFilter) ? "default" : "ghost",
                      onClick: handleAutomationsClick,
                      expandable: true,
                      expanded: isExpanded('nav:automations'),
                      onToggle: () => toggleExpanded('nav:automations'),
                      contextMenu: {
                        type: 'automations' as const,
                        onAddAutomation: openAddAutomation,
                      },
                      items: [
                        {
                          id: "nav:automations:scheduled",
                          title: t("sidebar.scheduled"),
                          label: String(automationTypeCounts.scheduled),
                          icon: Clock,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'scheduled') ? "default" : "ghost",
                          onClick: handleAutomationsScheduledClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                        {
                          id: "nav:automations:event",
                          title: t("sidebar.eventBased"),
                          label: String(automationTypeCounts.event),
                          icon: Radio,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'event') ? "default" : "ghost",
                          onClick: handleAutomationsEventClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                        {
                          id: "nav:automations:agentic",
                          title: t("sidebar.agentEvents"),
                          label: String(automationTypeCounts.agentic),
                          icon: Bot,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'agentic') ? "default" : "ghost",
                          onClick: handleAutomationsAgenticClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                      ],
                    },
                    // --- Separator ---
                    { id: "separator:skills-settings", type: "separator" },
                    // --- Settings ---
                    {
                      id: "nav:settings",
                      title: t("sidebar.settings"),
                      icon: Settings,
                      variant: isSettingsNavigation(navState) ? "default" : "ghost",
                      onClick: () => handleSettingsClick(),
                    },
                  ])}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                {/* Agents section removed */}
                </div>
              </div>

            </div>
          </div>
          }
          sidebarWidth={effectiveSidebarAndNavigatorHidden ? 0 : (isSidebarVisible ? sidebarWidth : 0)}
          navigatorSlot={
            <div
              style={{ width: isAutoCompact ? '100%' : sessionListWidth }}
              className="h-full flex flex-col min-w-0 relative z-panel"
            >
            <PanelHeader
              title={isSidebarVisible ? listTitle : undefined}
              titleAlign="start"
              compensateForStoplight={!isSidebarVisible}
              badge={automationFilter?.automationType === 'scheduled' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground/50 cursor-default flex items-center titlebar-no-drag">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px]">
                    Scheduling requires your machine to be running. It can be locked, but must be powered on.
                  </TooltipContent>
                </Tooltip>
              ) : undefined}
              actions={
                <>
                  {/* Sessions: search, then list / new-orchestration. Compact
                      hides the switcher and keeps search so the right edge
                      does not leave an empty slot. */}
                  {isSessionsNavigation(navState) && (
                    <div className="flex items-center gap-1.5">
                      <HeaderIconButton
                        icon={<Search className="h-4 w-4" />}
                        tooltip={t("sidebar.search")}
                        onClick={() => setSearchActive(true)}
                      />
                      {!isAutoCompact && (
                        <BoardListToggle
                          value="list"
                          onChange={view => {
                            if (view === 'board') navigate(routes.view.board())
                          }}
                        />
                      )}
                    </div>
                  )}
                  {/* Add Source button (only for sources mode) - uses filter-aware edit config */}
                  {isSourcesNavigation(navState) && activeWorkspace && (
                    <>
                      {workspaces.some((w) => w.id !== activeWorkspaceId && !w.remoteServer) && (
                        <HeaderIconButton
                          icon={<Copy className="h-4 w-4" />}
                          tooltip={t("sourcesList.copyFromWorkspace")}
                          onClick={() => setCopySourcesFromOpen(true)}
                        />
                      )}
                      <HeaderIconButton
                        icon={<FileUp className="h-4 w-4" />}
                        tooltip={t("fileImport.mcpTitle")}
                        onClick={() => setMcpFileImportOpen(true)}
                      />
                      <CreationJobsButton
                        workspaceId={activeWorkspace.id}
                        onReopen={reopenCreationJob}
                        onOpenResult={openCreationResult}
                      />
                      <EditPopover
                        trigger={
                          <HeaderIconButton
                            icon={<Plus className="h-4 w-4" />}
                            tooltip={t("sidebarMenu.addSource")}
                            data-tutorial="add-source-button"
                          />
                        }
                        {...getEditConfig(
                          sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                          activeWorkspace.rootPath
                        )}
                      />
                    </>
                  )}
                  {/* Add Skill button (only for skills mode) */}
                  {isSkillsNavigation(navState) && activeWorkspace && (
                    <>
                      {workspaces.some((w) => w.id !== activeWorkspaceId && !w.remoteServer) && (
                        <HeaderIconButton
                          icon={<Copy className="h-4 w-4" />}
                          tooltip={t("skillsList.copyFromWorkspace")}
                          onClick={() => setCopySkillsFromOpen(true)}
                        />
                      )}
                      <HeaderIconButton
                        icon={<FileUp className="h-4 w-4" />}
                        tooltip={t("fileImport.skillTitle")}
                        onClick={handleImportSkillFromFile}
                      />
                      <CreationJobsButton
                        workspaceId={activeWorkspace.id}
                        onReopen={reopenCreationJob}
                        onOpenResult={openCreationResult}
                      />
                      <EditPopover
                        trigger={
                          <HeaderIconButton
                            icon={<Plus className="h-4 w-4" />}
                            tooltip={t("sidebarMenu.addSkill")}
                            data-tutorial="add-skill-button"
                          />
                        }
                        {...getEditConfig('add-skill', activeWorkspace.rootPath)}
                      />
                    </>
                  )}
                  {/* Add Automation button (only for automations mode) */}
                  {isAutomationsNavigation(navState) && activeWorkspace && (
                    <>
                      <CreationJobsButton
                        workspaceId={activeWorkspace.id}
                        onReopen={reopenCreationJob}
                        onOpenResult={openCreationResult}
                      />
                      <EditPopover
                        trigger={
                          <HeaderIconButton
                            icon={<Plus className="h-4 w-4" />}
                            tooltip={t("sidebarMenu.addAutomation")}
                          />
                        }
                        {...getEditConfig('add-automation', activeWorkspace.rootPath)}
                      />
                    </>
                  )}
                  {/* Add Project button (only for projects mode) */}
                  {isProjectsNavigation(navState) && activeWorkspace && (
                    <HeaderIconButton
                      icon={<Plus className="h-4 w-4" />}
                      tooltip={t("sidebarMenu.addProject")}
                      onClick={openAddProject}
                    />
                  )}
                </>
              }
            />
            {/* Content: SessionList, SourcesListPanel, or SettingsNavigator based on navigation state */}
            {isSourcesNavigation(navState) && (
              /* Sources List - filtered by type if sourceFilter is active */
              <SourcesListPanel
                sources={sources}
                sourceFilter={sourceFilter}
                workspaceRootPath={activeWorkspace?.rootPath}
                onDeleteSource={handleDeleteSource}
                onSourceClick={handleSourceSelect}
                selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                localMcpEnabled={localMcpEnabled}
                copyFromOpen={copySourcesFromOpen}
                onCopyFromOpenChange={setCopySourcesFromOpen}
                onImportFromFile={() => setMcpFileImportOpen(true)}
              />
            )}
            {isSkillsNavigation(navState) && activeWorkspaceId && (
              /* Skills List */
              <SkillsListPanel
                skills={skills}
                workspaceId={activeWorkspaceId}
                workspaceRootPath={activeWorkspace?.rootPath}
                workingDirectory={activeSessionWorkingDirectory}
                onSkillClick={handleSkillSelect}
                onDeleteSkill={handleDeleteSkill}
                selectedSkillSlug={isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
                copyFromOpen={copySkillsFromOpen}
                onCopyFromOpenChange={setCopySkillsFromOpen}
                onImportFromFile={handleImportSkillFromFile}
                onImportDroppedFiles={handleImportSkillFromDrop}
              />
            )}
            {isProjectsNavigation(navState) && activeWorkspaceId && (
              /* Projects List */
              <ProjectsListPanel
                projects={projects}
                workspaceId={activeWorkspaceId}
                onProjectClick={(slug) => navigate(routes.view.projects(slug))}
                onAddProject={openAddProject}
                onJumpToSessions={handleJumpToProjectSessions}
                selectedProjectSlug={isProjectsNavigation(navState) ? navState.details?.projectSlug ?? null : null}
              />
            )}
            {isAutomationsNavigation(navState) && (
              /* Automations List - filtered by type if automationFilter is active */
              <AutomationsListPanel
                automations={automations}
                automationTestResults={automationTestResults}
                automationFilter={automationFilter ? { kind: AUTOMATION_TYPE_TO_FILTER_KIND[automationFilter.automationType] ?? 'all' } : undefined}
                onAutomationClick={handleAutomationSelect}
                onTestAutomation={handleTestAutomation}
                onSimulateMatchAutomation={handleSimulateMatch}
                onToggleAutomation={handleToggleAutomation}
                onDuplicateAutomation={handleDuplicateAutomation}
                onDeleteAutomation={handleDeleteAutomation}
                selectedAutomationId={isAutomationsNavigation(navState) && navState.details ? navState.details.automationId : null}
                workspaceRootPath={activeWorkspace?.rootPath}
              />
            )}
            {isSettingsNavigation(navState) && (
              /* Settings Navigator */
              <SettingsNavigator
                selectedSubpage={navState.subpage}
                onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
              />
            )}
            {isSessionsNavigation(navState) && (
              /* Sessions List */
              <>
                {/* SessionList: Scrollable list of session cards */}
                {/* Key on sidebarMode forces full remount when switching views, skipping animations */}
                <SessionList
                  key={sessionFilter?.kind}
                  items={searchActive ? workspaceSessionMetas : filteredSessionMetas}
                  onDelete={handleDeleteSession}
                  onFlag={onFlagSession}
                  onUnflag={onUnflagSession}
                  onArchive={onArchiveSession}
                  onUnarchive={onUnarchiveSession}
                  onMarkUnread={onMarkSessionUnread}
                  onSessionStatusChange={onSessionStatusChange}
                  onRename={onRenameSession}
                  onFocusChatInput={(targetSessionId) => {
                    focusChatInputForSession(targetSessionId ?? focusedSessionId ?? session.selected)
                  }}
                  onSessionSelect={(selectedMeta) => {
                    navigateToSession(selectedMeta.id)
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  onNavigateToView={() => {
                    navigate(routes.view.allSessions())
                  }}
                  sessionOptions={sessionOptions}
                  searchActive={searchActive}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSearchClose={() => {
                    setSearchActive(false)
                    setSearchQuery('')
                  }}
                  sessionStatuses={effectiveSessionStatuses}
                  evaluateViews={evaluateViews}
                  labels={displayLabelConfigs}
                  onLabelsChange={handleSessionLabelsChange}
                  projects={projectMenuOptions}
                  onSetProjectId={handleSessionProjectChange}
                  groupingMode="date"
                  workspaceId={activeWorkspaceId ?? undefined}
                  statusFilter={listFilter}
                  labelFilterMap={labelFilter}
                  projectFilter={projectFilter}
                  focusedSessionId={panelCount === 0 ? null : panelCount > 1 ? focusedSessionId : undefined}
                  onNavigateToSession={panelCount > 1 ? navigateToSessionInPanel : undefined}
                  hasPendingPrompt={hasPendingPrompt}
                  activeChatMatchInfo={chatMatchInfo}
                />
              </>
            )}
            {/* Mobile/compact-only FAB for starting a new chat — only on the
                session list itself, not when a chat is open (it would overlap
                the chat input). */}
            {isAutoCompact && isSessionsNavigation(navState) && !navState.details && (
              <FabNewChat onClick={() => handleNewChat()} />
            )}
            </div>
          }
          navigatorWidth={isAutoCompact ? sessionListWidth : (effectiveSidebarAndNavigatorHidden || isBoardView ? 0 : sessionListWidth)}
          isSidebarAndNavigatorHidden={effectiveSidebarAndNavigatorHidden}
          isRightSidebarVisible={false}
          isCompact={isAutoCompact}
          isResizing={!!isResizing}
        />

        {/* Sidebar Resize Handle (absolute, hidden in focused mode) */}
        {!effectiveSidebarAndNavigatorHidden && (
        <div
          ref={resizeHandleRef}
          onMouseDown={(e) => { e.preventDefault(); setIsResizing('sidebar') }}
          onMouseMove={(e) => {
            if (resizeHandleRef.current) {
              const rect = resizeHandleRef.current.getBoundingClientRect()
              setSidebarHandleY(e.clientY - rect.top)
            }
          }}
          onMouseLeave={() => { if (!isResizing) setSidebarHandleY(null) }}
          className="absolute cursor-col-resize z-panel flex justify-center"
          style={{
            width: PANEL_SASH_HIT_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
            left: isSidebarVisible
              ? sidebarWidth + (PANEL_GAP / 2) - PANEL_SASH_HALF_HIT_WIDTH
              : -PANEL_GAP,
            transition: isResizing === 'sidebar' ? undefined : 'left 0.15s ease-out',
          }}
        >
          <div
            className="h-full"
            style={{
              ...getResizeGradientStyle(sidebarHandleY, resizeHandleRef.current?.clientHeight ?? null),
              width: PANEL_SASH_LINE_WIDTH,
            }}
          />
        </div>
        )}

        {/* Session List Resize Handle (absolute, hidden in focused mode and board view) */}
        {!effectiveSidebarAndNavigatorHidden && !isBoardView && (
        <div
          ref={sessionListHandleRef}
          onMouseDown={(e) => { e.preventDefault(); setIsResizing('session-list') }}
          onMouseMove={(e) => {
            if (sessionListHandleRef.current) {
              const rect = sessionListHandleRef.current.getBoundingClientRect()
              setSessionListHandleY(e.clientY - rect.top)
            }
          }}
          onMouseLeave={() => { if (isResizing !== 'session-list') setSessionListHandleY(null) }}
          className="absolute cursor-col-resize z-panel flex justify-center"
          style={{
            width: PANEL_SASH_HIT_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
            left:
              (isSidebarVisible ? sidebarWidth + PANEL_GAP : PANEL_EDGE_INSET) +
              sessionListWidth +
              (PANEL_GAP / 2) -
              PANEL_SASH_HALF_HIT_WIDTH,
            transition: isResizing === 'session-list' ? undefined : 'left 0.15s ease-out',
          }}
        >
          <div
            className="h-full"
            style={{
              ...getResizeGradientStyle(sessionListHandleY, sessionListHandleRef.current?.clientHeight ?? null),
              width: PANEL_SASH_LINE_WIDTH,
            }}
          />
        </div>
        )}

      </div>

      {/* ============================================================================
       * CONTEXT MENU TRIGGERED EDIT POPOVERS
       * ============================================================================
       * These EditPopovers are opened programmatically from sidebar context menus.
       * They use controlled state (editPopoverOpen) and invisible anchors for positioning.
       * The anchor Y position is captured from the right-clicked item (editPopoverAnchorY ref)
       * so the popover appears near the triggering item rather than at a fixed location.
       * modal={true} prevents auto-close when focus shifts after context menu closes.
       */}
      {activeWorkspace && (
        <>
          {/* Configure Statuses EditPopover - anchored near sidebar */}
          <EditPopover
            open={editPopoverOpen === 'statuses'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'statuses' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            secondaryAction={{
              label: 'Edit File',
              filePath: `${activeWorkspace.rootPath}/statuses/config.json`,
            }}
            {...getEditConfig('edit-statuses', activeWorkspace.rootPath)}
          />
          {/* Configure Labels EditPopover - anchored near sidebar */}
          <EditPopover
            open={editPopoverOpen === 'labels'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'labels' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            secondaryAction={{
              label: 'Edit File',
              filePath: `${activeWorkspace.rootPath}/labels/config.json`,
            }}
            {...(() => {
              // Spread base config, override context to include which label was right-clicked
              const config = getEditConfig('edit-labels', activeWorkspace.rootPath)
              const targetLabel = editLabelTargetId.current
                ? findLabelById(labelConfigs, editLabelTargetId.current)
                : undefined
              if (!targetLabel) return config
              return {
                ...config,
                context: {
                  ...config.context,
                  context: (config.context.context || '') +
                    ` The user right-clicked on the label "${targetLabel.name}" (id: "${targetLabel.id}"). ` +
                    'If they refer to "this label" or "this", they mean this specific label.',
                },
              }
            })()}
          />
          {/* Edit Views EditPopover - anchored near sidebar */}
          <EditPopover
            open={editPopoverOpen === 'views'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'views' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            secondaryAction={{
              label: 'Edit File',
              filePath: `${activeWorkspace.rootPath}/views.json`,
            }}
            {...getEditConfig('edit-views', activeWorkspace.rootPath)}
          />
          {/* Add Source EditPopovers - one for each variant (generic + filter-specific)
           * editPopoverOpen can be: 'add-source', 'add-source-api', 'add-source-mcp', 'add-source-local'
           * Each variant uses its corresponding EditContextKey for filter-aware agent context */}
          {(['add-source', 'add-source-api', 'add-source-mcp', 'add-source-local'] as const).map((variant) => (
            <EditPopover
              key={variant}
              open={editPopoverOpen === variant}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? variant : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              {...getEditConfig(variant, activeWorkspace.rootPath)}
            />
          ))}
          {/* Add Skill EditPopover */}
          <EditPopover
            open={editPopoverOpen === 'add-skill'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-skill' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            {...getEditConfig('add-skill', activeWorkspace.rootPath)}
          />
          {activeWorkspaceId && (
            <>
              <input
                ref={skillFileInputRef}
                type="file"
                accept=".md,.zip"
                className="hidden"
                onChange={(event) => void handleSkillImportFileChange(event)}
              />
              <SkillFileDropDialog
                open={skillFileDropOpen}
                loading={skillFilePreparing}
                onChooseFile={handleChooseSkillFile}
                onDropFiles={handleImportSkillFromDrop}
                onOpenChange={(open) => {
                  if (open) setSkillFileDropOpen(true)
                  else finishSkillFileImport()
                }}
              />
              {preparedSkillFileImport && (
                <SkillFileImportDialog
                  open
                  workspaceId={preparedSkillFileImport.workspaceId}
                  prepared={preparedSkillFileImport.value}
                  onOpenChange={(open) => {
                    if (!open) finishSkillFileImport()
                  }}
                />
              )}
              <ExternalResourceImportDialog
                open={mcpFileImportOpen}
                workspaceId={activeWorkspaceId}
                onOpenChange={setMcpFileImportOpen}
              />
            </>
          )}
          {/* Add Automation EditPopover - triggered from "Add Automation" context menu in automations */}
          <EditPopover
            open={editPopoverOpen === 'add-automation'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-automation' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            {...getEditConfig('add-automation', activeWorkspace.rootPath)}
          />
          {/* Add Label EditPopover - triggered from "Add New Label" context menu on labels */}
          <EditPopover
            open={editPopoverOpen === 'add-label'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-label' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            secondaryAction={{
              label: 'Edit File',
              filePath: `${activeWorkspace.rootPath}/labels/config.json`,
            }}
            {...(() => {
              // Spread base config, override context to include which label was right-clicked
              const config = getEditConfig('add-label', activeWorkspace.rootPath)
              const targetLabel = editLabelTargetId.current
                ? findLabelById(labelConfigs, editLabelTargetId.current)
                : undefined
              if (!targetLabel) return config
              return {
                ...config,
                context: {
                  ...config.context,
                  context: (config.context.context || '') +
                    ` The user right-clicked on the label "${targetLabel.name}" (id: "${targetLabel.id}"). ` +
                    'The new label should be added as a sibling after this label, or as a child if the user specifies.',
                },
              }
            })()}
          />
        </>
      )}

      {/* Delete automation confirmation dialog */}
      <Dialog open={!!automationPendingDelete} onOpenChange={(open) => { if (!open) setAutomationPendingDelete(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dialog.deleteAutomation.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="dialog.deleteAutomation.description"
                values={{ name: pendingDeleteAutomation?.name }}
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationPendingDelete(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeleteAutomation}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Workspace dialog (driven by sendToWorkspaceAtom) */}
      <SendToWorkspaceDialog
        open={sendToWorkspaceIds.length > 0}
        onOpenChange={(open) => { if (!open) setSendToWorkspaceIds([]) }}
        sessionIds={sendToWorkspaceIds}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onTransferComplete={handleTransferComplete}
      />

      {/* Create Project dialog — prompts for a name so slugs stay meaningful */}
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onCancel={() => setCreateProjectDialogOpen(false)}
        onSubmit={handleCreateProjectSubmit}
      />

      {/* Messaging dialogs (pairing-code + WA connect) — driven by messagingDialogAtom.
          Mounted here so they survive context-menu / dropdown close. */}
      <MessagingDialogHost />

    </AppShellProvider>
  )
}
