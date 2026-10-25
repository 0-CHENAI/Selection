import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { LoaderCircle, MoreHorizontal, Plus, Presentation } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@craft-agent/shared/i18n'
import type { SessionMeta } from '@/atoms/sessions'
import { sendToWorkspaceAtom } from '@/atoms/sessions'
import { nextPptHistoryId, groupPptHistory, pptHistoryKind } from '@/components/ppt/history'
import { usePptCatalog } from '@/components/ppt/usePptCatalog'
import { Button } from '@/components/ui/button'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import { ContextMenuProvider, DropdownMenuProvider } from '@/components/ui/menu-context'
import {
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  shouldFireLongPress,
} from '@/components/ui/long-press-state'
import { useAppShellContext } from '@/context/AppShellContext'
import { useFocusContext } from '@/context/FocusContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useFocusZone, useRovingTabIndex } from '@/hooks/keyboard'
import { useSessionActions } from '@/hooks/useSessionActions'
import { draftSessionNavigateOptions, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { CompactSessionMenu } from './CompactSessionMenu'
import { SessionMenu, type SessionMenuProjectOption } from './SessionMenu'
import { SessionSearchHeader } from './SessionSearchHeader'
import { hasTransferTargets } from './transfer-targets'

const SUPPRESS_ACTIVATION_MS = 300

export function PptHistoryList({
  items,
  selectedSessionId,
  onSelect,
  onNew,
  projects,
  onSetProjectId,
  onOpenInNewWindow,
}: {
  items: SessionMeta[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  projects?: SessionMenuProjectOption[]
  onSetProjectId?: (sessionId: string, projectId: string | null) => void
  onOpenInNewWindow?: (sessionId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = React.useState('')
  const { catalog } = usePptCatalog()
  const templates = React.useMemo(() => new Map(catalog?.templates.map(template => [template.id, template])), [catalog])
  const ordered = React.useMemo(() => [...items].sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0)), [items])
  const visible = React.useMemo(() => ordered.filter(item =>
    `${item.name ?? ''} ${item.preview ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [ordered, query])
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [isSearchFocused, setIsSearchFocused] = React.useState(false)
  const { focusZone } = useFocusContext()
  const focusFirst = React.useCallback(() => {
    const row = listRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
    if (row) {
      row.focus()
      row.scrollIntoView({ block: 'nearest' })
    } else {
      searchInputRef.current?.focus()
    }
  }, [])
  const { zoneRef, isFocused } = useFocusZone({ zoneId: 'navigator', focusFirst })
  const keyboard = useRovingTabIndex({
    items: visible,
    getId: item => item.id,
    enabled: isFocused || isSearchFocused,
    moveFocus: !isSearchFocused,
    onNavigate: item => {
      onSelect(item.id)
      document.getElementById(`item-${item.id}`)?.scrollIntoView({ block: 'nearest' })
    },
    onActivate: item => {
      onSelect(item.id)
      focusZone('chat', { intent: 'keyboard' })
    },
  })
  const { setActiveIndex } = keyboard
  React.useEffect(() => {
    const index = visible.findIndex(item => item.id === selectedSessionId)
    setActiveIndex(index >= 0 ? index : 0)
  }, [visible, selectedSessionId, setActiveIndex])
  React.useEffect(() => {
    if (selectedSessionId) {
      document.getElementById(`item-${selectedSessionId}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedSessionId, visible])
  const indices = React.useMemo(() => new Map(visible.map((item, index) => [item.id, index])), [visible])
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
      focusZone('navigator', { intent: 'keyboard' })
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
      keyboard.getContainerProps().onKeyDown(event)
    }
  }
  const grouped = groupPptHistory(visible)
  const groups = [
    { label: t('ppt.recent'), items: grouped.recent },
    { label: t('ppt.thisWeek'), items: grouped.thisWeek },
    { label: t('ppt.earlier'), items: grouped.earlier },
  ]

  const { onDeleteSession, onRenameSession, onMarkSessionUnread, workspaces, isCompactMode } = useAppShellContext()
  const { navigate } = useNavigation()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const { handleDeleteWithToast } = useSessionActions({ onDelete: onDeleteSession })
  const selectedIdRef = React.useRef(selectedSessionId)
  selectedIdRef.current = selectedSessionId
  const orderedRef = React.useRef(ordered)
  orderedRef.current = ordered
  const [renameSessionId, setRenameSessionId] = React.useState<string | null>(null)
  const [renameName, setRenameName] = React.useState('')
  const canSendToWorkspace = hasTransferTargets(workspaces)
  const deleteSession = React.useCallback(async (sessionId: string) => {
    const snapshot = orderedRef.current
    const deleted = await handleDeleteWithToast(sessionId)
    // Leave the route the user moved to while the confirmation was open.
    if (!deleted || selectedIdRef.current !== sessionId) return
    const nextId = nextPptHistoryId(snapshot, sessionId)
    navigate(nextId ? routes.view.ppt(nextId) : routes.view.ppt(), nextId ? undefined : draftSessionNavigateOptions())
  }, [handleDeleteWithToast, navigate])
  const openRename = React.useCallback((sessionId: string, name: string) => {
    setRenameSessionId(sessionId)
    setRenameName(name)
  }, [])

  return <div ref={zoneRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col" data-testid="ppt-history">
    <SessionSearchHeader searchQuery={query} onSearchChange={setQuery} placeholder={t('ppt.searchHistory')} resultCount={visible.length} inputRef={searchInputRef} onKeyDown={handleSearchKeyDown} onFocus={() => { setIsSearchFocused(true); focusZone('navigator', { intent: 'click', moveFocus: false }) }} onBlur={() => setIsSearchFocused(false)} />
    {items.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-foreground/4 text-muted-foreground"><Presentation className="size-6" strokeWidth={1.5} /></div>
      <p className="text-sm font-medium">{t('ppt.emptyTitle')}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('ppt.emptyDescription')}</p>
      <Button type="button" variant="ghost" onClick={onNew} className="mt-4 h-8 gap-1.5 rounded-[6px] bg-background px-3 text-[13px] shadow-minimal"><Plus className="size-3.5" />{t('ppt.new')}</Button>
    </div> : <div ref={listRef} role="listbox" aria-label={t('ppt.searchHistory')} className="min-h-0 flex-1 overflow-y-auto pb-4">
      {visible.length === 0 && <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t('ppt.noSearchResults')}</p>}
      {groups.filter(group => group.items.length > 0).map(group => <section key={group.label}>
        <div className="px-4 pb-1 pt-3 text-[11px] font-medium tracking-wider text-muted-foreground">{group.label}</div>
        {group.items.map(item => {
          const template = item.ppt?.templateId ? templates.get(item.ppt.templateId) : undefined
          const selected = item.id === selectedSessionId
          const timestamp = item.lastMessageAt ?? item.createdAt
          const index = indices.get(item.id)!
          const title = getSessionTitle(item)
          return <PptHistoryRow
            key={item.id}
            item={item}
            title={title}
            selected={selected}
            timestamp={timestamp}
            language={i18n.language}
            templateCover={template?.cover}
            templateTitle={template?.title}
            itemProps={keyboard.getItemProps(item, index)}
            isCompactMode={!!isCompactMode}
            templatePages={template?.pages}
            projects={projects}
            canSendToWorkspace={canSendToWorkspace}
            onSelect={() => { focusZone('navigator', { intent: 'click', moveFocus: false }); onSelect(item.id) }}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                event.stopPropagation()
                focusZone(event.key === 'ArrowLeft' ? 'sidebar' : 'chat', { intent: 'keyboard' })
              } else {
                keyboard.getItemProps(item, index).onKeyDown(event)
              }
            }}
            onRename={() => openRename(item.id, title)}
            onMarkUnread={() => onMarkSessionUnread(item.id)}
            onOpenInNewWindow={() => onOpenInNewWindow?.(item.id)}
            onSendToWorkspace={canSendToWorkspace ? () => setSendToWorkspace([item.id]) : undefined}
            onSetProjectId={onSetProjectId ? projectId => { void onSetProjectId(item.id, projectId) } : undefined}
            onDelete={() => { void deleteSession(item.id) }}
          />
        })}
      </section>)}
    </div>}
    <RenameDialog
      open={renameSessionId !== null}
      onOpenChange={open => { if (!open) setRenameSessionId(null) }}
      title={t('session.renameSession')}
      value={renameName}
      onValueChange={setRenameName}
      onSubmit={() => {
        if (renameSessionId && renameName.trim()) onRenameSession(renameSessionId, renameName.trim())
        setRenameSessionId(null)
        setRenameName('')
      }}
      placeholder={t('session.enterSessionName')}
    />
  </div>
}

function PptHistoryRow({
  item,
  title,
  selected,
  timestamp,
  language,
  templateCover,
  templateTitle,
  templatePages,
  itemProps,
  isCompactMode,
  projects,
  canSendToWorkspace,
  onSelect,
  onKeyDown,
  onRename,
  onMarkUnread,
  onOpenInNewWindow,
  onSendToWorkspace,
  onSetProjectId,
  onDelete,
}: {
  item: SessionMeta
  title: string
  selected: boolean
  timestamp?: number
  language: string
  templateCover?: string
  templateTitle?: string
  templatePages?: number
  itemProps: React.ButtonHTMLAttributes<HTMLButtonElement>
  isCompactMode: boolean
  projects?: SessionMenuProjectOption[]
  canSendToWorkspace: boolean
  onSelect: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
  onRename: () => void
  onMarkUnread: () => void
  onOpenInNewWindow: () => void
  onSendToWorkspace?: () => void
  onSetProjectId?: (projectId: string | null) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false)
  const [compactOpen, setCompactOpen] = React.useState(false)
  const gesture = useCompactRowGesture(isCompactMode, () => setCompactOpen(true))
  const menuHeld = menuOpen || contextMenuOpen || compactOpen
  const generating = item.isProcessing || !!item.pptProgress?.generating
  const renderMenu = () => (
    <SessionMenu
      item={item}
      hasTransferTargets={canSendToWorkspace}
      projects={projects}
      onSetProjectId={onSetProjectId}
      onRename={onRename}
      onMarkUnread={onMarkUnread}
      onOpenInNewWindow={onOpenInNewWindow}
      onSendToWorkspace={onSendToWorkspace}
      onDelete={onDelete}
    />
  )
  const row = (
    <div className="group relative mr-2 pl-2" data-session-id={item.id} data-testid="ppt-history-item">
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <button
        {...itemProps}
        type="button"
        onKeyDown={onKeyDown}
        onClick={() => { if (!gesture.consumeActivation()) onSelect() }}
        onPointerDown={gesture.pointerProps.onPointerDown}
        onPointerMove={gesture.pointerProps.onPointerMove}
        onPointerUp={gesture.pointerProps.onPointerUp}
        onPointerCancel={gesture.pointerProps.onPointerCancel}
        onPointerLeave={gesture.pointerProps.onPointerLeave}
        onContextMenu={gesture.pointerProps.onContextMenu}
        aria-selected={selected}
        aria-current={selected ? 'page' : undefined}
        className={cn('flex w-full items-center gap-3 rounded-lg py-2.5 pl-2 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-foreground/3' : 'hover:bg-foreground/2')}
      >
        <span title={templateTitle ? t('ppt.referenceTemplate', { title: templateTitle }) : undefined} className="relative flex h-[38px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-foreground/5 shadow-minimal">
          {templateCover ? <img src={templateCover} alt={t('ppt.referenceCover')} className="h-full w-full object-cover" /> : <Presentation className="size-5 text-muted-foreground" />}
          {generating && <span className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]"><LoaderCircle className="size-3.5 animate-spin text-accent motion-reduce:animate-none" /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px]', generating && 'animate-shimmer-text')}>{item.name || item.preview || t('ppt.new')}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{historyStatus(item, templatePages, t)}</span>
        </span>
        {timestamp && <span className={cn('self-start whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground', menuHeld ? 'invisible' : isCompactMode ? undefined : 'group-hover:invisible')}>{formatDistanceToNow(timestamp, { locale: getDateLocale(language), addSuffix: false })}</span>}
      </button>
      <div
        data-touch-reveal="true"
        className={cn('absolute right-2 top-2 z-10', menuHeld ? 'opacity-100' : isCompactMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        {isCompactMode ? (
          <button type="button" aria-label={t('common.more')} aria-haspopup="dialog" aria-expanded={compactOpen} data-testid="ppt-history-menu" onClick={() => setCompactOpen(true)} className="cursor-pointer rounded-[6px] p-1 hover:bg-foreground/10">
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ) : (
          <DropdownMenu modal open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <div aria-label={t('common.more')} data-testid="ppt-history-menu" className="cursor-pointer rounded-[6px] p-1 hover:bg-foreground/10 data-[state=open]:bg-foreground/10">
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end">
              <DropdownMenuProvider>{renderMenu()}</DropdownMenuProvider>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {isCompactMode && (
        <CompactSessionMenu
          open={compactOpen}
          onOpenChange={setCompactOpen}
          trigger={null}
          title={title}
          item={item}
          hasTransferTargets={canSendToWorkspace}
          onRename={onRename}
          onMarkUnread={onMarkUnread}
          onOpenInNewWindow={onOpenInNewWindow}
          onSendToWorkspace={onSendToWorkspace}
          onDelete={onDelete}
        />
      )}
    </div>
  )

  if (isCompactMode) return row
  return (
    <ContextMenu modal onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <StyledContextMenuContent>
        <ContextMenuProvider>{renderMenu()}</ContextMenuProvider>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function historyStatus(item: SessionMeta, templatePages: number | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  const kind = pptHistoryKind({ processing: item.isProcessing, progress: item.pptProgress, templatePages })
  if (kind.kind === 'progress') return t('ppt.generatingProgress', { current: kind.current, total: kind.total })
  if (kind.kind === 'generating') return t('ppt.generating')
  if (kind.kind === 'pages') return t('ppt.pages', { count: kind.count })
  return 'PPTX'
}

function useCompactRowGesture(enabled: boolean, onOpen: () => void) {
  const pointerDownRef = React.useRef<{ x: number; y: number; timer: number } | null>(null)
  const suppressRef = React.useRef(false)
  const cancel = React.useCallback(() => {
    if (!pointerDownRef.current) return
    window.clearTimeout(pointerDownRef.current.timer)
    pointerDownRef.current = null
  }, [])
  React.useEffect(() => cancel, [cancel])
  const open = React.useCallback(() => {
    onOpen()
    suppressRef.current = true
    window.setTimeout(() => { suppressRef.current = false }, SUPPRESS_ACTIVATION_MS)
  }, [onOpen])
  if (!enabled) return { consumeActivation: () => false, pointerProps: {} as CompactPointerProps }
  return {
    consumeActivation: () => {
      if (!suppressRef.current) return false
      suppressRef.current = false
      return true
    },
    pointerProps: {
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse') return
        const timer = window.setTimeout(() => {
          open()
          pointerDownRef.current = null
        }, LONG_PRESS_MS)
        pointerDownRef.current = { x: event.clientX, y: event.clientY, timer }
      },
      onPointerMove: (event: React.PointerEvent) => {
        const state = pointerDownRef.current
        if (!state) return
        if (shouldFireLongPress({ x: state.x, y: state.y }, { x: event.clientX, y: event.clientY }, 0, LONG_PRESS_MS, MOVE_TOLERANCE_PX).cancel) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault()
        open()
      },
    },
  }
}

interface CompactPointerProps {
  onPointerDown?: (event: React.PointerEvent) => void
  onPointerMove?: (event: React.PointerEvent) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onPointerLeave?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}
