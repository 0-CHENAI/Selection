/**
 * CompactSessionMenu
 *
 * Bottom-sheet replacement for the desktop ChatPage title dropdown
 * (`SessionMenu` wrapped by `PanelHeader`'s Radix DropdownMenu) when
 * `AppShellContext.isCompactMode === true`. Mirrors the same actions but
 * routes Connect Messaging submenus through
 * an internal view stack instead of nested Radix popovers — Radix submenus
 * get clipped by the panel container query on narrow viewports, and the
 * nested submenus can fall off the right edge.
 *
 * Pattern matches the other compact pickers (`CompactWorkspaceSwitcher`,
 * `CompactPermissionModeSelector`) and also
 * follows the iOS-style drill-in behaviour established by `MobileAppMenu`.
 *
 * Side-effect handlers (refresh title / copy path) come from
 * `useSessionMenuActions`, shared with the
 * desktop `SessionMenu` so a new session action only has to be wired
 * through one place.
 *
 * Leaf actions close the drawer on tap. Label toggles do NOT close the
 * drawer so the user can apply multiple labels in one pass — same UX as
 * the desktop submenu.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  FolderOpen,
  MailOpen,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import type { SessionMeta } from '@/atoms/sessions'
import { hasUnreadMeta, hasMessagesMeta } from '@/utils/session'
import { getFileManagerName } from '@/lib/platform'
import { useMessagingConnect, type MessagingPlatform } from '@/components/messaging/MessagingSessionMenuItem'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'

type View = 'root' | 'messaging'

export interface CompactSessionMenuProps {
  /** Title text shown in the trigger button + drawer header. */
  title?: string
  /** Optional badge element rendered next to the title (e.g. agent badge). */
  badge?: React.ReactNode
  /** Shimmer animation while the title is being regenerated. */
  isRegeneratingTitle?: boolean

  // Session data — same as SessionMenu
  item: SessionMeta
  hasTransferTargets?: boolean

  // Callbacks — same as SessionMenu
  onRename: () => void
  onMarkUnread: () => void
  onOpenInNewWindow: () => void
  onSendToWorkspace?: () => void
  onDelete: () => void

  // ---------------------------------------------------------------------------
  // Controlled-component shim — used by EntityRow / SessionItem so a single
  // drawer instance can be driven from multiple triggers (`…` button + long-
  // press). When `open` is omitted the component owns its own state (the
  // chat-header callsite, unchanged). Matches the Radix Dialog convention.
  // ---------------------------------------------------------------------------
  /** Controlled open state. When omitted, the component owns its own state. */
  open?: boolean
  /** Notifies the consumer when the controlled open state should change. */
  onOpenChange?: (open: boolean) => void
  /** Custom trigger node. `null` opts out of rendering ANY trigger (the row
   *  provides its own). When omitted, renders the title-pill trigger used
   *  by the chat header. */
  trigger?: React.ReactNode | null
}

export function CompactSessionMenu({
  title,
  badge,
  isRegeneratingTitle,
  item,
  hasTransferTargets,
  onRename,
  onMarkUnread,
  onOpenInNewWindow,
  onSendToWorkspace,
  onDelete,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: CompactSessionMenuProps) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )
  const [view, setView] = React.useState<View>('root')

  // Reset to root pane every time the drawer closes so the next open
  // doesn't surprise the user with a sub-pane from the previous session.
  React.useEffect(() => {
    if (!open) setView('root')
  }, [open])

  // Close+reset the drawer if the underlying session changes while it's open.
  // Otherwise action handlers retarget to the new session (e.g. user opens
  // menu for A, navigation switches to B, "Delete" deletes B).
  React.useEffect(() => {
    setOpen(false)
    setView('root')
  }, [item.id, setOpen])

  const _hasMessages = hasMessagesMeta(item)
  const _hasUnread = hasUnreadMeta(item)

  const actions = useSessionMenuActions({ item })

  // Wrap a callback so it also closes the drawer. Async callbacks fire
  // their work in the background — the drawer doesn't need to stay open
  // for the request to complete.
  const closeAfter = React.useCallback(
    <T extends (...args: never[]) => void | Promise<void>>(fn?: T) => {
      if (!fn) return undefined
      return ((...args: Parameters<T>) => {
        void fn(...args)
        setOpen(false)
      }) as T
    },
    [setOpen],
  )

  const connectMessaging = useMessagingConnect({ sessionId: item.id })
  const handleConnectMessaging = (platform: MessagingPlatform) => {
    setOpen(false)
    void connectMessaging(platform)
  }

  // ---------------------------------------------------------------------------
  // Drawer header — shared between root + sub-panes. Sub-panes show a back
  // chevron; the root pane shows the session title.
  // ---------------------------------------------------------------------------
  const headerTitle = (() => {
    switch (view) {
      case 'messaging': return t('sessionMenu.connectMessaging')
      default:          return title ?? ''
    }
  })()

  const showBack = view !== 'root'

  // Resolve the trigger node:
  //   - `trigger === null`  → don't render any trigger (row provides its own).
  //   - `trigger` provided  → render the consumer's node inside DrawerTrigger.
  //   - `trigger` omitted   → render the default title-pill button (chat header).
  const triggerNode = trigger === null
    ? null
    : trigger !== undefined
      ? <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      : (
        <DrawerTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md titlebar-no-drag min-w-0',
              'hover:bg-foreground/[0.03] transition-colors',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'data-[state=open]:bg-foreground/[0.03]',
            )}
            aria-label={title}
          >
            <motion.div
              initial={false}
              animate={{ opacity: title ? 1 : 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1 min-w-0"
            >
              <h1
                className={cn(
                  'text-sm font-semibold truncate font-sans leading-tight',
                  isRegeneratingTitle && 'animate-shimmer-text',
                )}
              >
                {title}
              </h1>
              {badge}
            </motion.div>
            <span className="shrink-0 flex items-center justify-center">
              <ChevronDown className="h-3.5 w-3.5 text-foreground/50 translate-y-[1px]" />
            </span>
          </button>
        </DrawerTrigger>
      )

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {triggerNode}

      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="!flex flex-row items-center gap-2 !text-left pr-3">
          {showBack && (
            <button
              type="button"
              onClick={() => setView('root')}
              className="-ml-1 h-8 w-8 rounded-md flex items-center justify-center hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-foreground/50"
              aria-label={t('common.back')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <DrawerTitle className="flex-1 min-w-0 truncate">{headerTitle}</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6">
          {view === 'root' && (
            <RootPane
              hasMessages={_hasMessages}
              hasUnread={_hasUnread}
              hasTransferTargets={hasTransferTargets}
              onSendToWorkspace={closeAfter(onSendToWorkspace)}
              onOpenMessagingSub={() => setView('messaging')}
              onMarkUnread={closeAfter(onMarkUnread)}
              onRename={closeAfter(onRename)}
              onRefreshTitle={closeAfter(actions.refreshTitle)}
              onOpenInNewPanel={closeAfter(actions.openInNewPanel)}
              onOpenInNewWindow={closeAfter(onOpenInNewWindow)}
              onShowInFinder={closeAfter(actions.showInFinder)}
              onCopyPath={closeAfter(actions.copyPath)}
              onDelete={closeAfter(onDelete)}
            />
          )}

          {view === 'messaging' && (
            <MessagingPane onConnect={handleConnectMessaging} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

interface RootPaneProps {
  hasMessages: boolean
  hasUnread: boolean
  hasTransferTargets?: boolean
  onSendToWorkspace?: () => void
  onOpenMessagingSub: () => void
  onMarkUnread?: () => void
  onRename?: () => void
  onRefreshTitle?: () => void
  onOpenInNewPanel?: () => void
  onOpenInNewWindow?: () => void
  onShowInFinder?: () => void
  onCopyPath?: () => void
  onDelete?: () => void
}

function RootPane({
  hasMessages,
  hasUnread,
  hasTransferTargets,
  onSendToWorkspace,
  onOpenMessagingSub,
  onMarkUnread,
  onRename,
  onRefreshTitle,
  onOpenInNewPanel,
  onOpenInNewWindow,
  onShowInFinder,
  onCopyPath,
  onDelete,
}: RootPaneProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col">
      {hasTransferTargets && onSendToWorkspace && (
        <Row icon={<Send className="h-4 w-4" />} label={t('sessionMenu.sendToWorkspace')} onTap={onSendToWorkspace} />
      )}

      <Row
        icon={<MessageSquare className="h-4 w-4" />}
        label={t('sessionMenu.connectMessaging')}
        chevron
        onTap={onOpenMessagingSub}
      />

      <Separator />

      {!hasUnread && hasMessages && (
        <Row icon={<MailOpen className="h-4 w-4" />} label={t('sessionMenu.markAsUnread')} onTap={onMarkUnread} />
      )}

      <Separator />

      <Row icon={<Pencil className="h-4 w-4" />} label={t('common.rename')} onTap={onRename} />
      <Row icon={<RefreshCw className="h-4 w-4" />} label={t('sessionMenu.regenerateTitle')} onTap={onRefreshTitle} />

      <Separator />

      <Row icon={<Columns2 className="h-4 w-4" />} label={t('sessionMenu.openInNewPanel')} onTap={onOpenInNewPanel} />
      {onOpenInNewWindow && (
        <Row icon={<AppWindow className="h-4 w-4" />} label={t('sessionMenu.openInNewWindow')} onTap={onOpenInNewWindow} />
      )}
      <Row
        icon={<FolderOpen className="h-4 w-4" />}
        label={t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
        onTap={onShowInFinder}
      />
      <Row icon={<Copy className="h-4 w-4" />} label={t('sessionMenu.copyPath')} onTap={onCopyPath} />

      <Separator />

      <Row
        icon={<Trash2 className="h-4 w-4" />}
        label={t('common.delete')}
        destructive
        onTap={onDelete}
      />
    </div>
  )
}

/* Removed session classification panes retained here temporarily only to make
 * the deletion diff reviewable alongside the compact-menu rewrite.
function StatusPane({
  sessionStatuses,
  activeStateId,
  onSelect,
}: {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (id: SessionStatusId) => void
}) {
  return (
    <div className="flex flex-col">
      {sessionStatuses.map((state) => {
        const bareStateIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <Row
            key={state.id}
            icon={<span style={getStatusIconStyle(state)}>{bareStateIcon}</span>}
            label={state.label}
            radioSelected={activeStateId === state.id}
            onTap={() => onSelect(state.id)}
          />
        )
      })}
    </div>
  )
}

function LabelsPane({
  items,
  appliedLabelIds,
  onToggle,
}: {
  items: LabelMenuItem[]
  appliedLabelIds: Set<string>
  onToggle: (id: string) => void
}) {
  // Obsolete classification pane.
  // ever entered when items.length > 0 — no empty-state branch needed.
  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const isApplied = appliedLabelIds.has(item.id)
        return (
          <Row
            key={item.id}
            icon={<LabelIcon label={item.config} size="lg" />}
            label={item.parentPath ? (
              <>
                <span className="text-foreground/50">{item.parentPath}</span>
                {item.label}
              </>
            ) : item.label}
            radioSelected={isApplied}
            onTap={() => onToggle(item.id)}
          />
        )
      })}
    </div>
  )
}



*/
function MessagingPane({ onConnect }: { onConnect: (platform: MessagingPlatform) => void }) {
  return (
    <div className="flex flex-col">
      <Row icon={<MessageSquare className="h-4 w-4" />} label="Telegram" onTap={() => onConnect('telegram')} />
      <Row icon={<MessageSquare className="h-4 w-4" />} label="WhatsApp" onTap={() => onConnect('whatsapp')} />
      <Row icon={<MessageSquare className="h-4 w-4" />} label="Lark / Feishu" onTap={() => onConnect('lark')} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  radioSelected?: boolean
  destructive?: boolean
  onTap?: () => void
}

function Row({
  icon,
  label,
  trailing,
  chevron,
  radioSelected,
  destructive,
  onTap,
}: RowProps) {
  if (!onTap) return null
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'flex items-center gap-3 w-full px-3 py-3 rounded-[10px] text-left transition-colors',
        'hover:bg-foreground/5 active:bg-foreground/10',
        destructive && 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5">
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-sm truncate">{label}</span>
      {trailing}
      {radioSelected && <Check className="h-4 w-4 shrink-0 text-foreground/70" />}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-foreground/50" />}
    </button>
  )
}

function Separator() {
  return <div className="my-1 mx-3 h-px bg-foreground/[0.06]" />
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-[11px] tabular-nums text-foreground/50">
      {count}
    </span>
  )
}
