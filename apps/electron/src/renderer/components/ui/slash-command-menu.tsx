import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Command as CommandPrimitive } from 'cmdk'
import { Check, Minimize2 } from 'lucide-react'
import { Icon_Folder } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, type PermissionMode } from '@craft-agent/shared/agent/modes'
import { AGENTS_PLUGIN_NAME } from '@craft-agent/shared/skills/types'
import type { LoadedSkill } from '../../../shared/types'
import { resolveSkillTitle } from '@craft-agent/shared/display-titles'
import { SkillAvatar } from '@/components/ui/skill-avatar'

// ============================================================================
// Types
// ============================================================================

export type SlashCommandId = PermissionMode | 'compact'

/** Union type for all item types in the slash menu */
export type SlashItemType = 'command' | 'folder' | 'skill'

export interface SlashCommand {
  id: SlashCommandId
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  /** Optional color for the command (hex color string) */
  color?: string
}

/** Folder item for the slash menu */
export interface SlashFolderItem {
  id: string
  type: 'folder'
  label: string
  description: string
  path: string
}

/** Skill item for the slash menu (`/` inserts a [skill:…] mention) */
export interface SlashSkillItem {
  id: string
  type: 'skill'
  label: string
  description: string
  skill: LoadedSkill
}

export type SlashMenuItem = SlashCommand | SlashFolderItem | SlashSkillItem

/** Section with header for the inline slash menu */
export interface SlashSection {
  id: string
  label: string
  items: SlashMenuItem[]
}

export interface CommandGroup {
  id: string
  commands: SlashCommand[]
}

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

interface PermissionModeIconProps {
  mode: PermissionMode
  className?: string
}

function PermissionModeIcon({ mode, className }: PermissionModeIconProps) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

// ============================================================================
// Default Commands
// ============================================================================

// Icon size constant
const MENU_ICON_SIZE = 'h-3.5 w-3.5'

// Generate permission mode commands from centralized config
const permissionModeCommands: SlashCommand[] = PERMISSION_MODE_ORDER.map(mode => {
  const config = PERMISSION_MODE_CONFIG[mode]
  return {
    id: mode,
    label: config.displayName,
    description: config.description,
    icon: <PermissionModeIcon mode={mode} className={MENU_ICON_SIZE} />,
  }
})

const compactCommand: SlashCommand = {
  id: 'compact',
  label: 'Compact Context',
  description: 'Summarize conversation context to free up token budget',
  icon: <Minimize2 className={MENU_ICON_SIZE} />,
}

/** Commands available from the `/` inline menu (modes are NOT included — use the mode badge UI). */
export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  compactCommand,
]

/**
 * Permission-mode groups for the mode dropdown badge (ActiveOptionBadges).
 * Not shown in the `/` slash autocomplete.
 */
export const DEFAULT_SLASH_COMMAND_GROUPS: CommandGroup[] = [
  { id: 'modes', commands: permissionModeCommands },
]

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[260px] overflow-y-auto py-1'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] mx-1 px-2 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-foreground/5'
const MENU_SECTION_HEADER = 'px-3 py-1.5 mb-0.5 text-[12px] font-medium text-muted-foreground border-b border-foreground/5'

// ============================================================================
// Shared: Filter utilities
// ============================================================================

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  if (!filter) return commands
  const lowerFilter = filter.toLowerCase()
  return commands.filter(
    cmd =>
      cmd.label.toLowerCase().includes(lowerFilter) ||
      cmd.id.toLowerCase().includes(lowerFilter)
  )
}

/** Check if an item is a folder */
function isFolder(item: SlashMenuItem): item is SlashFolderItem {
  return 'type' in item && item.type === 'folder'
}

/** Check if an item is a skill */
function isSkill(item: SlashMenuItem): item is SlashSkillItem {
  return 'type' in item && item.type === 'skill'
}

/** Filter sections by label/id, keeping sections grouped */
function filterSections(sections: SlashSection[], filter: string): SlashSection[] {
  if (!filter) return sections
  const lowerFilter = filter.toLowerCase()

  // Filter items within each section, keeping section structure
  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.label.toLowerCase().includes(lowerFilter) ||
        item.id.toLowerCase().includes(lowerFilter) ||
        item.description?.toLowerCase().includes(lowerFilter) ||
        (isSkill(item) && item.skill.metadata.name.toLowerCase().includes(lowerFilter))
      ),
    }))
    .filter(section => section.items.length > 0)
}

/** Flatten sections into a single array of items */
function flattenSections(sections: SlashSection[]): SlashMenuItem[] {
  return sections.flatMap(section => section.items)
}

// ============================================================================
// Shared: Command Item Content
// ============================================================================

const MODE_COMMAND_IDS = new Set<string>(['safe', 'ask', 'allow-all'])

function CommandItemContent({ command, isActive }: { command: SlashCommand; isActive: boolean }) {
  const { t } = useTranslation()
  const label = MODE_COMMAND_IDS.has(command.id) ? t(`mode.${command.id}`, command.label) : command.label
  return (
    <>
      <div className="shrink-0 text-muted-foreground">{command.icon}</div>
      <div className="flex-1 min-w-0">{label}</div>
      {isActive && (
        <div className="shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center">
          <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
        </div>
      )}
    </>
  )
}

// ============================================================================
// SlashCommandMenu Component (Button-triggered popup)
// ============================================================================

export interface SlashCommandMenuProps {
  /** Flat list of commands (use this OR commandGroups, not both) */
  commands?: SlashCommand[]
  /** Grouped commands with separators between groups */
  commandGroups?: CommandGroup[]
  activeCommands?: SlashCommandId[]
  onSelect: (commandId: SlashCommandId) => void
  showFilter?: boolean
  filterPlaceholder?: string
  className?: string
}

export function SlashCommandMenu({
  commands,
  commandGroups,
  activeCommands = [],
  onSelect,
  showFilter = false,
  filterPlaceholder,
  className,
}: SlashCommandMenuProps) {
  const { t } = useTranslation()
  const effectiveFilterPlaceholder = filterPlaceholder ?? t("commands.searchCommands")
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // If groups provided, filter within each group; otherwise use flat commands
  const filteredGroups = React.useMemo(() => {
    if (commandGroups) {
      return commandGroups.map(group => ({
        ...group,
        commands: filterCommands(group.commands, filter),
      })).filter(group => group.commands.length > 0)
    }
    return null
  }, [commandGroups, filter])

  const filteredCommands = React.useMemo(() => {
    if (commands && !commandGroups) {
      return filterCommands(commands, filter)
    }
    return null
  }, [commands, commandGroups, filter])

  // Get all commands for defaultValue calculation
  const allFilteredCommands = filteredGroups
    ? filteredGroups.flatMap(g => g.commands)
    : (filteredCommands ?? [])

  // Default to the first active command, or first command if none active
  const defaultValue = activeCommands[0] ?? allFilteredCommands[0]?.id

  React.useEffect(() => {
    // Don't auto-focus the filter on touch devices — it pulls up the virtual keyboard
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (showFilter && inputRef.current && !isTouchDevice) {
      inputRef.current.focus()
    }
  }, [showFilter])

  if (allFilteredCommands.length === 0 && !showFilter) return null

  // Render a single command item
  const renderCommandItem = (cmd: SlashCommand) => {
    const isActive = activeCommands.includes(cmd.id)
    return (
      <CommandPrimitive.Item
        key={cmd.id}
        value={cmd.id}
        onSelect={() => onSelect(cmd.id)}
        data-tutorial={`permission-mode-${cmd.id}`}
        className={cn(
          MENU_ITEM_STYLE,
          'outline-none',
          'data-[selected=true]:bg-foreground/5'
        )}
      >
        <CommandItemContent command={cmd} isActive={isActive} />
      </CommandPrimitive.Item>
    )
  }

  return (
    <CommandPrimitive
      className={cn(MENU_CONTAINER_STYLE, className)}
      shouldFilter={false}
      defaultValue={defaultValue}
    >
      {showFilter && (
        <div className="border-b border-border/50 px-3 py-2">
          <CommandPrimitive.Input
            ref={inputRef}
            value={filter}
            onValueChange={setFilter}
            placeholder={effectiveFilterPlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <CommandPrimitive.List className={MENU_LIST_STYLE}>
        {allFilteredCommands.length === 0 ? (
          <CommandPrimitive.Empty className="py-4 text-center text-sm text-muted-foreground">
            No commands found
          </CommandPrimitive.Empty>
        ) : filteredGroups ? (
          // Group-based rendering with smart separators
          filteredGroups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {group.commands.map(renderCommandItem)}
              {/* Separator: only show if there's another group after this one */}
              {groupIndex < filteredGroups.length - 1 && (
                <div className="h-px bg-border/50 my-1 mx-2" />
              )}
            </React.Fragment>
          ))
        ) : (
          // Flat list rendering
          filteredCommands?.map(renderCommandItem)
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

// ============================================================================
// InlineSlashCommand - Autocomplete that follows cursor
// ============================================================================

export interface InlineSlashCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: SlashSection[]
  activeCommands?: SlashCommandId[]
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  onSelectSkill: (skill: LoadedSkill) => void
  filter?: string
  position: { x: number; y: number }
  className?: string
  /** Workspace slug for skill avatars */
  workspaceId?: string
}

export function InlineSlashCommand({
  open,
  onOpenChange,
  sections,
  activeCommands = [],
  onSelectCommand,
  onSelectFolder,
  onSelectSkill,
  filter = '',
  position,
  className,
  workspaceId,
}: InlineSlashCommandProps) {
  const { t } = useTranslation()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenSections(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Scroll selected item into view
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Handle item selection
  const handleSelect = React.useCallback((item: SlashMenuItem) => {
    if (isFolder(item)) {
      onSelectFolder(item.path)
    } else if (isSkill(item)) {
      onSelectSkill(item.skill)
    } else {
      onSelectCommand(item.id)
    }
    onOpenChange(false)
  }, [onSelectCommand, onSelectFolder, onSelectSkill, onOpenChange])

  // Keyboard navigation
  // Don't attach listener when no items - allows Enter to propagate to input handler
  React.useEffect(() => {
    if (!open || flatItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            handleSelect(flatItems[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, flatItems, selectedIndex, handleSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Hide if no results or not open
  if (!open || flatItems.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  // Track current item index across all sections
  let currentItemIndex = 0

  return (
    <div
      ref={menuRef}
      data-inline-menu
      className={cn('fixed z-dropdown', MENU_CONTAINER_STYLE, className)}
      style={{ left: Math.round(position.x) - 10, bottom: bottomPosition, minWidth: 220, maxWidth: 260 }}
    >
      <div ref={listRef} className={MENU_LIST_STYLE}>
        {filteredSections.map((section, sectionIndex) => (
          <React.Fragment key={section.id}>
            {/* Section header */}
            <div className={MENU_SECTION_HEADER}>
              {section.label}
            </div>

            {/* Section items */}
            {section.items.map((item) => {
              const itemIndex = currentItemIndex++
              const isSelected = itemIndex === selectedIndex

              if (isFolder(item)) {
                // Folder item - single line with path
                return (
                  <div
                    key={`${section.id}-${item.id}`}
                    data-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={cn(
                      MENU_ITEM_STYLE,
                      isSelected && MENU_ITEM_SELECTED
                    )}
                  >
                    <div className="shrink-0 text-muted-foreground">
                      <Icon_Folder className={MENU_ICON_SIZE} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0 truncate">
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-1.5">{item.description}</span>
                    </div>
                  </div>
                )
              }

              if (isSkill(item)) {
                return (
                  <div
                    key={`${section.id}-${item.id}`}
                    data-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={cn(
                      MENU_ITEM_STYLE,
                      isSelected && MENU_ITEM_SELECTED
                    )}
                  >
                    <div className="shrink-0">
                      <SkillAvatar skill={item.skill} size="sm" workspaceId={workspaceId} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{item.label}</span>
                    </div>
                    <span className="rounded-[4px] shadow-minimal bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0">
                      {t('common.skill')}
                    </span>
                  </div>
                )
              }

              // Command item
              const isActive = activeCommands.includes(item.id)
              return (
                <div
                  key={item.id}
                  data-selected={isSelected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  className={cn(
                    MENU_ITEM_STYLE,
                    isSelected && MENU_ITEM_SELECTED
                  )}
                >
                  <CommandItemContent command={item} isActive={isActive} />
                </div>
              )
            })}

          </React.Fragment>
        ))}
      </div>
      {/* Always-visible footer hint for @ file mentions */}
      <div className="h-px bg-border/50 mx-2" />
      <div className="px-3 py-2.5 select-none text-xs text-muted-foreground">
        {t('chat.slashHintUseAtForFiles', 'Use @ for files')}
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline slash command state
// ============================================================================

/** Interface for elements that can be used with useInlineSlashCommand */
export interface SlashCommandInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

/**
 * Format path for display, shortening home directory
 */
function formatPathForDisplay(path: string, homeDir?: string): string {
  if (homeDir && path.startsWith(homeDir)) {
    return '~' + path.slice(homeDir.length)
  }
  return path
}

/**
 * Get folder name from path
 */
function getFolderName(path: string): string {
  return path.split('/').pop() || path
}

export interface UseInlineSlashCommandOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<SlashCommandInputElement | null>
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  activeCommands?: SlashCommandId[]
  recentFolders?: string[]
  homeDir?: string
  /** Skills shown in the `/` menu (not in `@`) */
  skills?: LoadedSkill[]
  /** Workspace slug for fully-qualified skill mentions */
  workspaceId?: string
}

export interface UseInlineSlashCommandReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: SlashSection[]
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  activeCommands: SlashCommandId[]
  handleSelectCommand: (commandId: SlashCommandId) => string
  handleSelectFolder: (path: string) => string
  handleSelectSkill: (skill: LoadedSkill) => { value: string; cursorPosition: number }
}

export function useInlineSlashCommand({
  inputRef,
  onSelectCommand,
  onSelectFolder,
  activeCommands = [],
  recentFolders = [],
  homeDir,
  skills = [],
  workspaceId,
}: UseInlineSlashCommandOptions): UseInlineSlashCommandReturn {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [slashStart, setSlashStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Build sections: skills → commands (no modes) → recent folders
  const sections = React.useMemo((): SlashSection[] => {
    const result: SlashSection[] = []

    // Skills section (moved from @ mention menu)
    if (skills.length > 0) {
      result.push({
        id: 'skills',
        label: t('common.skills', 'Skills'),
        items: skills.map(skill => ({
          id: skill.slug,
          type: 'skill' as const,
          label: resolveSkillTitle(skill),
          description: skill.metadata.description || '',
          skill,
        })),
      })
    }

    // Commands section (compact, etc. — modes are handled by the mode badge UI)
    result.push({
      id: 'commands',
      label: t('commands.section', 'Commands'),
      items: [compactCommand],
    })

    // Recent folders section - sorted alphabetically by folder name, show all
    if (recentFolders.length > 0) {
      const sortedFolders = [...recentFolders]
        .sort((a, b) => {
          const nameA = getFolderName(a).toLowerCase()
          const nameB = getFolderName(b).toLowerCase()
          return nameA.localeCompare(nameB)
        })

      result.push({
        id: 'folders',
        label: t('chat.recentWorkingDirectories', 'Recent Working Directories'),
        items: sortedFolders.map(path => ({
          id: path,
          type: 'folder' as const,
          label: getFolderName(path),
          description: formatPathForDisplay(path, homeDir),
          path,
        })),
      })
    }

    return result
  }, [recentFolders, homeDir, skills, t])

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    // Allow Unicode skill names / hyphens (not just ASCII \w)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([^\n\[\]@\s]{0,100})?$/)

    // Only show menu if we have sections with items
    const hasItems = sections.some(s => s.items.length > 0)

    if (slashMatch && hasItems) {
      const filterText = slashMatch[1] || ''
      // Check if there are any filtered results before opening menu
      // This ensures Enter key works normally when no matches exist
      const filteredSections = filterSections(sections, filterText)
      const hasFilteredItems = filteredSections.some(s => s.items.length > 0)

      if (!hasFilteredItems) {
        // No results after filtering - close menu to allow normal Enter handling
        setIsOpen(false)
        setFilter('')
        setSlashStart(-1)
        return
      }

      const matchStart = textBeforeCursor.lastIndexOf('/')
      setSlashStart(matchStart)
      setFilter(filterText)

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setSlashStart(-1)
    }
  }, [inputRef, sections])

  const handleSelectCommand = React.useCallback((commandId: SlashCommandId): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      result = (before + after).trim()
    }

    // Now safe to trigger state changes
    onSelectCommand(commandId)
    setIsOpen(false)

    return result
  }, [onSelectCommand, slashStart])

  const handleSelectFolder = React.useCallback((path: string): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    // Folder selection directly changes working directory, doesn't insert text
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      // Just remove the /command text, no badge insertion
      result = (before + after).trim()
    }

    // Trigger working directory change
    onSelectFolder(path)
    setIsOpen(false)

    return result
  }, [onSelectFolder, slashStart])

  const handleSelectSkill = React.useCallback((skill: LoadedSkill): { value: string; cursorPosition: number } => {
    let result = ''
    let newCursorPosition = 0
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      // Plugin name depends on which tier the skill came from:
      //   workspace → workspaceId, project/global → ".agents"
      const pluginName = skill.source === 'workspace' ? workspaceId : AGENTS_PLUGIN_NAME
      const qualifiedName = pluginName ? `${pluginName}:${skill.slug}` : skill.slug
      const mentionText = `[skill:${qualifiedName}] `
      result = before + mentionText + after
      newCursorPosition = before.length + mentionText.length
    }
    setIsOpen(false)
    return { value: result, cursorPosition: newCursorPosition }
  }, [slashStart, workspaceId])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setSlashStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    sections,
    handleInputChange,
    close,
    activeCommands,
    handleSelectCommand,
    handleSelectFolder,
    handleSelectSkill,
  }
}
