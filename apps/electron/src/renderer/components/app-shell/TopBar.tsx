/**
 * TopBar - Persistent top bar above all panels (Slack-style)
 *
 * Desktop: [Sidebar] [Back] [Forward] [Workspace selector] ... [Browser strip]
 * Compact: [App menu] [Workspace selector]
 *
 * Fixed at top of window, 48px tall.
 * macOS: offset left to avoid stoplight controls.
 */

import { useTranslation } from "react-i18next"
import * as Icons from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { TopBarButton } from "../ui/TopBarButton"
import { cn } from "@/lib/utils"
import { isMac, isWebUI } from "@/lib/platform"
import { useActionLabel } from "@/actions"
import type { SettingsMenuItem } from "../../../shared/menu-schema"
import { useEffect, useRef, useState } from "react"
import { BrowserTabStrip } from "../browser/BrowserTabStrip"
import type { Workspace } from "../../../shared/types"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { CompactWorkspaceSwitcher } from "./CompactWorkspaceSwitcher"
import { AppMenu } from "../AppMenu"

const RIGHT_SLOT_FULL_BADGES_THRESHOLD = 420
const RIGHT_SLOT_TWO_BADGES_THRESHOLD = 300

interface TopBarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  activeSessionId?: string | null
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
  onToggleSidebar: () => void
  onToggleFocusMode: () => void
  /** When true, hides controls that don't apply in compact/mobile layout */
  isCompact?: boolean
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  activeSessionId,
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onToggleSidebar,
  onToggleFocusMode,
  isCompact,
}: TopBarProps) {
  const { t } = useTranslation()
  const [maxVisibleBrowserBadges, setMaxVisibleBrowserBadges] = useState(3)
  const rightSlotRef = useRef<HTMLDivElement | null>(null)

  const goBackHotkey = useActionLabel('nav.goBackAlt').hotkey
  const goForwardHotkey = useActionLabel('nav.goForwardAlt').hotkey

  useEffect(() => {
    const slotEl = rightSlotRef.current
    if (!slotEl) return

    let frame = 0

    const updateBadgeDensity = () => {
      const slotWidth = slotEl.getBoundingClientRect().width
      const nextMaxVisibleBadges = slotWidth >= RIGHT_SLOT_FULL_BADGES_THRESHOLD
        ? 3
        : slotWidth >= RIGHT_SLOT_TWO_BADGES_THRESHOLD
          ? 2
          : 1

      setMaxVisibleBrowserBadges((prev) => (prev === nextMaxVisibleBadges ? prev : nextMaxVisibleBadges))
    }

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateBadgeDensity)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(slotEl)
    updateBadgeDensity()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [workspaces.length, activeWorkspaceId])

  // Stoplight padding clears macOS traffic-light controls, which only exist
  // in the Electron desktop window. The webui runs in a regular browser tab
  // and has no traffic lights regardless of host OS — collapse to a normal
  // 12px inset so the first control sits at the edge.
  const menuLeftPadding = isMac && !isWebUI ? 86 : 12

  return (
    <div
      className="fixed top-0 left-0 right-0 z-panel titlebar-drag-region"
      style={{ height: 'var(--topbar-height)' }}
    >
      <div className="flex h-full w-full items-center justify-between gap-2">
      {/* === LEFT: Sidebar + Navigation + Workspace (compact: App menu) === */}
      {/* Keep this container draggable. Only individual interactive controls should use titlebar-no-drag. */}
      {/* In compact mode the right slot is hidden, so we add right padding here
          so the workspace pill doesn't run flush against the viewport edge. */}
      <div
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5"
        style={{ paddingLeft: menuLeftPadding, paddingRight: isCompact ? 12 : 0 }}
      >
        <div className="flex items-center gap-0.5">
        {!isCompact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton onClick={onToggleSidebar} aria-label={t("menu.toggleSidebar")}>
              <PanelLeftRounded className="h-[18px] w-[18px] text-foreground/70" />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("menu.toggleSidebar")}</TooltipContent>
        </Tooltip>
        )}

        {isCompact && (
        <AppMenu
          onNewChat={onNewChat}
          onNewWindow={onNewWindow}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={onOpenSettingsSubpage}
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onToggleSidebar={onToggleSidebar}
          onToggleFocusMode={onToggleFocusMode}
        />
        )}
        </div>

        {/* Back / Forward / Workspace selector (moved from center).
            In compact mode the back/forward buttons are dropped — the iOS-style
            drill-in chevron in PanelHeader plus the browser's native back gesture
            cover that affordance, and the freed width lets the workspace pill
            actually fit on phone-width viewports. */}
        <div className={cn("ml-1 flex min-w-0 items-center gap-1", isCompact ? "flex-1" : "w-[clamp(220px,42vw,640px)]")}>
          {!isCompact && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onBack} disabled={!canGoBack} aria-label={t("common.back")}>
                    <Icons.ChevronLeft className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.back")} {goBackHotkey}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onForward} disabled={!canGoForward} aria-label={t("common.forward")}>
                    <Icons.ChevronRight className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.forward")} {goForwardHotkey}</TooltipContent>
              </Tooltip>
            </>
          )}

          <div className="min-w-0 flex-1">
            {isCompact ? (
              <CompactWorkspaceSwitcher
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onSelect={onSelectWorkspace}
                onWorkspaceCreated={onWorkspaceCreated}
                onWorkspaceRemoved={onWorkspaceRemoved}
                workspaceUnreadMap={workspaceUnreadMap}
              />
            ) : (
              <WorkspaceSwitcher
                variant="topbar"
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onSelect={onSelectWorkspace}
                onWorkspaceCreated={onWorkspaceCreated}
                onWorkspaceRemoved={onWorkspaceRemoved}
                workspaceUnreadMap={workspaceUnreadMap}
              />
            )}
          </div>
        </div>
      </div>

      {/* === RIGHT: Browser strip === */}
      {!isCompact && (
      <div ref={rightSlotRef} className="flex min-w-0 shrink-0 items-center justify-end gap-1" style={{ paddingRight: 12 }}>
        <div className="min-w-0">
          <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={maxVisibleBrowserBadges} />
        </div>
      </div>
      )}
      </div>
    </div>
  )
}
