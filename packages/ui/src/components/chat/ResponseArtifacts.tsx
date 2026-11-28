import * as React from 'react'
import { AlertTriangle, ExternalLink, Folder, FolderOpen, ChevronDown, ChevronUp, Globe, Layers3, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileTypeIcon } from './attachment-helpers'
import { mergeArtifactSupplements, useArtifactSupplements, type MergedArtifactRow } from './artifact-supplements'
import {
  artifactCategory,
  artifactPathKey,
  canOpenLiveHtmlArtifact,
  extractDeliveredResponseArtifacts,
  organizeArtifactShelf,
  resolveArtifactPrimaryAction,
  type ArtifactCategory,
  type ArtifactChange,
  type ArtifactFolderGroup,
  type ResponseArtifact,
} from './response-artifacts'
import { usePlatform } from '../../context/PlatformContext'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '../ui/StyledDropdown'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

const COLLAPSED_MAX_ITEMS = 4
const EXPANDED_PAGE_SIZE = 24
const GROUP_PAGE_SIZE = 20

const CHANGE_CHIP: Record<ArtifactChange, string> = {
  created: 'bg-[color-mix(in_oklab,var(--success)_14%,var(--background))] text-success',
  modified: 'bg-[color-mix(in_oklab,var(--accent)_14%,var(--background))] text-accent',
  deleted: 'bg-[color-mix(in_oklab,var(--destructive)_14%,var(--background))] text-destructive',
  restored: 'bg-[color-mix(in_oklab,var(--info)_18%,var(--background))] text-info',
}

function officeAppName(extension: string): string | undefined {
  if (/^(docx?|docm|dotx?|dotm|rtf)$/.test(extension)) return 'Word'
  if (/^(xlsx?|xlsm|xlsb|xltx?|xltm|csv)$/.test(extension)) return 'Excel'
  if (/^(pptx?|pptm|potx?|potm|ppsx?|ppsm)$/.test(extension)) return 'PowerPoint'
  return undefined
}

type ArtifactVersionRef = NonNullable<import('@craft-agent/core').Message['artifactVersions']>[number]
type OpenArtifactFn = (path: string, action: 'preview' | 'live' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => void | boolean | Promise<void | boolean>

/** Compact delivery shelf, outside the annotated reply body and above message actions. */
export function ResponseArtifacts({ artifacts, versions, responseText, onOpenFile, onOpenArtifact, anchors = [], mode = 'settled' }: {
  artifacts: ResponseArtifact[]
  versions?: import('@craft-agent/core').Message['artifactVersions']
  /** Assistant reply prose used to rank explicitly referenced deliverables ahead of batch files. */
  responseText?: string
  onOpenFile?: (path: string) => void
  onOpenArtifact?: OpenArtifactFn
  /** Identities of this reply. A supplement targets one of them. */
  anchors?: readonly string[]
  /** Pending keeps only live supplemented rows, before the rest of the shelf settles. */
  mode?: 'settled' | 'pending'
}) {
  const { t } = useTranslation()
  const { onManageArtifact, onOpenFileExternal, onRevealInFinder, fileManagerName, canOpenHtmlInBrowser } = usePlatform()
  const supplements = useArtifactSupplements()
  const [expanded, setExpanded] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<'grouped' | 'flat'>('grouped')
  const [activeCategory, setActiveCategory] = React.useState<'all' | ArtifactCategory>('all')
  const [visibleLimit, setVisibleLimit] = React.useState(EXPANDED_PAGE_SIZE)
  const [openGroupIds, setOpenGroupIds] = React.useState<Set<string>>(() => new Set())
  const [groupLimits, setGroupLimits] = React.useState<Record<string, number>>({})
  const [unavailable, setUnavailable] = React.useState(new Set<string>())
  const [openingVersion, setOpeningVersion] = React.useState<string | null>(null)
  const openRequests = React.useRef(new Map<string, number>())
  const versionRequest = React.useRef(0)
  const listId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const wasExpanded = React.useRef(false)

  const open = async (path: string, action: 'preview' | 'live' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => {
    const request = (openRequests.current.get(path) ?? 0) + 1
    const versionRequestId = action === 'versions' ? ++versionRequest.current : 0
    if (action === 'versions') setOpeningVersion(path)
    else openRequests.current.set(path, request)
    let succeeded = false
    try {
      const result = onOpenArtifact ? await onOpenArtifact(path, action, versionId, artifactId)
        : action === 'external' ? await onOpenFileExternal?.(path)
          : action === 'reveal' ? await onRevealInFinder?.(path) : await onOpenFile?.(path)
      succeeded = result !== false
    } catch { /* Keep the error on the artifact after transient notifications disappear. */ }
    if (action === 'versions') {
      if (versionRequestId === versionRequest.current) setOpeningVersion(null)
      return
    }
    if (openRequests.current.get(path) !== request) return
    setUnavailable(previous => {
      const next = new Set(previous)
      if (succeeded) next.delete(path); else next.add(path)
      return next
    })
  }

  React.useLayoutEffect(() => {
    if (wasExpanded.current && !expanded && sectionRef.current
      && sectionRef.current.getBoundingClientRect().top < 0) {
      sectionRef.current.scrollIntoView({ block: 'start' })
    }
    wasExpanded.current = expanded
  }, [expanded])

  const mergedRows = React.useMemo(
    () => mergeArtifactSupplements(artifacts, supplements, anchors, mode),
    [artifacts, supplements, anchors, mode],
  )

  const versionByPath = React.useMemo(() => {
    const map = new Map<string, ArtifactVersionRef>()
    if (!versions?.length) return map
    for (const item of versions) {
      const key = artifactPathKey(item.path)
      if (!map.has(key)) map.set(key, item)
    }
    return map
  }, [versions])

  const organized = React.useMemo(
    () => organizeArtifactShelf(mergedRows, { responseText: mode === 'settled' ? responseText : undefined }),
    [mergedRows, responseText, mode],
  )

  const effectiveCategory: 'all' | ArtifactCategory = activeCategory === 'all'
    || organized.categories.some(item => item.category === activeCategory)
    ? activeCategory
    : 'all'

  const filteredFlatRows = React.useMemo(() => {
    if (effectiveCategory === 'all') return organized.orderedRows
    return organized.orderedRows.filter(row => artifactCategory(row.artifact.extension) === effectiveCategory)
  }, [organized.orderedRows, effectiveCategory])

  if (mergedRows.length === 0) return null

  const totalCount = organized.orderedRows.length
  const showCategoryFilters = expanded && totalCount >= 6 && organized.categories.length >= 2
  const showFlatMode = expanded && (viewMode === 'flat' || effectiveCategory !== 'all' || !organized.hasGroups)

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds(previous => {
      const next = new Set(previous)
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId)
      return next
    })
  }

  const renderArtifactCard = (row: MergedArtifactRow, keySuffix: string, listItemClass: string) => {
    const artifact = row.artifact
    const supplement = row.supplement
    const version = versionByPath.get(artifactPathKey(artifact.path))
    const change = artifact.change
    const isLiveHtml = canOpenLiveHtmlArtifact(artifact, canOpenHtmlInBrowser)
    const openAction = resolveArtifactPrimaryAction({
      artifact,
      canOpenHtmlInBrowser,
      hasArtifactHandler: Boolean(onOpenArtifact),
    })
    const activate = () => {
      if (supplement?.onActivate) supplement.onActivate()
      else void open(artifact.path, openAction, version?.versionId, version?.artifactId)
    }
    const standardItems = <>
      {isLiveHtml && (onOpenArtifact || onOpenFile) && (
        <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'live', undefined, version?.artifactId) }}>
          <Globe />{t('preview.openInBrowser')}
        </StyledDropdownMenuItem>
      )}
      {version && onManageArtifact && onOpenArtifact && <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'versions', version.versionId) }}><Layers3 />{t('chat.artifactVersions.title')}</StyledDropdownMenuItem>}
      {(onOpenArtifact || onOpenFileExternal) && (
        <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'external', version?.versionId, version?.artifactId) }}>
          <ExternalLink />
          {officeAppName(artifact.extension) ? t('chat.artifactOfficeApp', { app: officeAppName(artifact.extension) }) : t('chat.artifactDefaultApp')}
        </StyledDropdownMenuItem>
      )}
      {(onOpenArtifact || onRevealInFinder) && (
        <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'reveal', version?.versionId, version?.artifactId) }}>
          <FolderOpen />{t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })}
        </StyledDropdownMenuItem>
      )}
    </>
    const trailing = !supplement?.trailing
      ? null
      : typeof supplement.trailing === 'function'
        ? supplement.trailing(standardItems)
        : supplement.trailing
    const shellClass = cn('relative flex min-w-0 items-center rounded-xl transition-colors hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.07] has-[[data-state=open]]:bg-foreground/[0.07]', change === 'deleted' ? 'bg-[color-mix(in_oklab,var(--destructive)_7%,var(--background))]' : 'bg-foreground/[0.04]')
    return (
      <li key={artifact.path} className={listItemClass}>
        <div data-testid={supplement?.testId} className={shellClass} onClick={supplement ? event => {
          const target = event.target
          if (!(target instanceof Element) || target.closest('button, a, [role="menuitem"]')) return
          activate()
        } : undefined}>
          {supplement ? <>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5">
              <button type="button" onClick={activate} aria-describedby={unavailable.has(artifact.path) ? `${listId}-error-${keySuffix}` : undefined} aria-label={`${t('common.open')} ${artifact.name}`} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <FileTypeIcon fileName={artifact.name} className="size-6" />
              </button>
              <span className="min-w-0 flex-1">
                <button type="button" onClick={activate} title={artifact.name} className="block w-full truncate text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{artifact.name}</button>
                <div className="mt-0.5 min-w-0 truncate text-xs leading-4 text-muted-foreground">{supplement.meta}</div>
              </span>
            </div>
            {trailing}
            {typeof supplement.progress === 'number' && <span aria-hidden="true" data-testid="artifact-row-progress" data-progress={String(Math.round(Math.max(0, Math.min(1, supplement.progress)) * 1000) / 1000)} className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden rounded-b-xl bg-foreground/10">
              <span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, supplement.progress)) * 100}%` }} />
            </span>}
          </> : <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!onOpenArtifact && !onOpenFile}
                onClick={() => { void open(artifact.path, openAction, version?.versionId, version?.artifactId) }}
                aria-describedby={unavailable.has(artifact.path) ? `${listId}-error-${keySuffix}` : undefined}
                aria-label={`${change ? t(`chat.artifactChange.${change}`) : t('common.open')} ${artifact.name}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <FileTypeIcon fileName={artifact.name} className="size-6" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-medium', change === 'deleted' && 'text-muted-foreground line-through')}>{artifact.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{artifact.extension.toUpperCase()}</span>
                    {change && <span className={cn('inline-flex items-center rounded px-1 py-px text-[10px] font-medium', CHANGE_CHIP[change])}>{t(`chat.artifactChange.${change}`)}</span>}
                    {version && <span className="inline-flex items-center gap-1"><Layers3 aria-hidden="true" className="size-3" />{t('chat.artifactVersions.version', { number: version.sessionOrdinal ?? version.ordinal })}</span>}
                  </span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(28rem,calc(100vw-2rem))] break-all">
              {artifact.name}
            </TooltipContent>
          </Tooltip>
          {(onOpenArtifact || onOpenFileExternal || onRevealInFinder || (isLiveHtml && onOpenFile)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`${t('chat.artifactOpenWith')} ${artifact.name}`} aria-busy={openingVersion === artifact.path} className="mr-2 inline-flex shrink-0 items-center gap-1 border-0 bg-transparent px-1 py-2 text-xs text-muted-foreground shadow-none outline-none hover:text-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:text-foreground">
                  {t('chat.artifactOpenWith')}{openingVersion === artifact.path ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <ChevronDown aria-hidden="true" className="size-3" />}
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                {standardItems}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          )}
          </>}
        </div>
        {unavailable.has(artifact.path) && <div id={`${listId}-error-${keySuffix}`} role="status" className="mt-1 flex flex-wrap items-center gap-1.5 px-2 text-xs text-foreground">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-info" />
          <span>{t('toast.failedToOpenFile')}</span>
          {version && onManageArtifact && onOpenArtifact && <button type="button" className="underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" onClick={() => { void open(artifact.path, 'versions', version.versionId) }}>{t('chat.artifactVersions.title')}</button>}
        </div>}
      </li>
    )
  }

  const renderGroupCard = (group: ArtifactFolderGroup, listItemClass: string) => {
    const isGroupOpen = openGroupIds.has(group.id)
    const FolderIcon = isGroupOpen ? FolderOpen : Folder
    const canReveal = !!(onOpenArtifact || onRevealInFinder)
    return (
      <li key={group.id} className={listItemClass}>
        <div
          data-testid="artifact-folder-group"
          className={cn(
            'relative flex min-w-0 items-center rounded-xl transition-colors hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.07]',
            isGroupOpen ? 'bg-foreground/[0.07] ring-1 ring-border/60' : 'bg-foreground/[0.04]',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-expanded={isGroupOpen}
                onClick={() => toggleGroup(group.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{group.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>{t('chat.artifactGroupCount', { count: group.rows.length })}</span>
                    {group.extensions.length > 0 && <>
                      <span aria-hidden="true">·</span>
                      <span>{group.extensions.join(' / ')}</span>
                    </>}
                  </span>
                </span>
                {isGroupOpen
                  ? <ChevronUp aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  : <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(28rem,calc(100vw-2rem))] break-all">
              {group.dirPath || group.label}
            </TooltipContent>
          </Tooltip>
          {canReveal && (
            <button
              type="button"
              onClick={() => { void open(group.revealPath, 'reveal') }}
              title={t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })}
              aria-label={`${t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })} ${group.label}`}
              className="mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FolderOpen aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
      </li>
    )
  }

  const responsiveItemClass = (index: number) => cn(
    'min-w-0 grow basis-full @[400px]/artifacts:basis-[calc((100%-0.5rem)/2)] @[560px]/artifacts:basis-[calc((100%-1rem)/3)] @[720px]/artifacts:basis-[calc((100%-1.5rem)/4)]',
    !expanded && index > 0 && (
      index === 1 ? 'hidden @[400px]/artifacts:block'
        : index === 2 ? 'hidden @[560px]/artifacts:block'
          : index === 3 ? 'hidden @[720px]/artifacts:block' : 'hidden'
    ),
  )

  const collapsedShelfItems = organized.shelfItems.slice(0, COLLAPSED_MAX_ITEMS)
  const activeGroupedItems = expanded ? organized.shelfItems.slice(0, visibleLimit) : collapsedShelfItems
  const activeFlatItems = filteredFlatRows.slice(0, visibleLimit)
  const remainingCount = showFlatMode
    ? Math.max(0, filteredFlatRows.length - activeFlatItems.length)
    : expanded ? Math.max(0, organized.shelfItems.length - activeGroupedItems.length) : 0

  const openedGroups = !showFlatMode
    ? activeGroupedItems
        .filter((item): item is ArtifactFolderGroup => item.kind === 'group' && openGroupIds.has(item.id))
    : []

  const showExpandToggle = totalCount > 1

  return (
    <TooltipProvider>
      <section ref={sectionRef} aria-label={t('chat.artifacts')} className="@container/artifacts px-2.5 pb-3 pt-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>{t('chat.artifacts')}</span>
            {totalCount > COLLAPSED_MAX_ITEMS && (
              <span className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[11px] font-normal tabular-nums text-muted-foreground">
                {totalCount}
              </span>
            )}
          </div>
          {expanded && organized.hasGroups && effectiveCategory === 'all' && (
            <div className="inline-flex items-center rounded-lg bg-foreground/[0.04] p-0.5 text-[11px]">
              <button
                type="button"
                aria-pressed={viewMode === 'grouped'}
                onClick={() => { setViewMode('grouped'); setVisibleLimit(EXPANDED_PAGE_SIZE) }}
                className={cn(
                  'rounded-md px-2 py-0.5 transition-colors',
                  viewMode === 'grouped' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('chat.artifactViewGrouped')}
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'flat'}
                onClick={() => { setViewMode('flat'); setVisibleLimit(EXPANDED_PAGE_SIZE) }}
                className={cn(
                  'rounded-md px-2 py-0.5 transition-colors',
                  viewMode === 'flat' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('chat.artifactViewFlat')}
              </button>
            </div>
          )}
        </div>

        {showCategoryFilters && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group">
            <button
              type="button"
              aria-pressed={effectiveCategory === 'all'}
              onClick={() => { setActiveCategory('all'); setVisibleLimit(EXPANDED_PAGE_SIZE) }}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors',
                effectiveCategory === 'all'
                  ? 'bg-foreground/10 font-medium text-foreground'
                  : 'bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground',
              )}
            >
              <span>{t('chat.artifactCategory.all')}</span>
              <span className="tabular-nums opacity-75">{totalCount}</span>
            </button>
            {organized.categories.map(({ category, count }) => (
              <button
                key={category}
                type="button"
                aria-pressed={effectiveCategory === category}
                onClick={() => { setActiveCategory(category); setVisibleLimit(EXPANDED_PAGE_SIZE) }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors',
                  effectiveCategory === category
                    ? 'bg-foreground/10 font-medium text-foreground'
                    : 'bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground',
                )}
              >
                <span>{t(`chat.artifactCategory.${category}`)}</span>
                <span className="tabular-nums opacity-75">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Container queries keep the row limit in sync; flex growth fills incomplete rows.
            Shift by the chip's own padding so the file icon lines up with message actions. */}
        <ul id={listId} className="-ml-3 flex flex-wrap gap-2">
          {showFlatMode
            ? activeFlatItems.map((row, index) => renderArtifactCard(row, `flat-${index}`, responsiveItemClass(index)))
            : activeGroupedItems.map((item, index) => item.kind === 'group'
                ? renderGroupCard(item, responsiveItemClass(index))
                : renderArtifactCard(item.row, `item-${index}`, responsiveItemClass(index)))}
        </ul>

        {openedGroups.map(group => {
          const limit = groupLimits[group.id] ?? GROUP_PAGE_SIZE
          const visibleGroupRows = group.rows.slice(0, limit)
          const remainingGroupRows = Math.max(0, group.rows.length - visibleGroupRows.length)
          return (
            <div key={group.id} data-testid="artifact-folder-drawer" className="mt-2 rounded-xl border border-border/50 bg-foreground/[0.02] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 items-center gap-1.5">
                  <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate font-medium text-foreground/85">{group.label}</span>
                  <span className="shrink-0 tabular-nums">({group.rows.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {t('chat.collapseArtifacts')}
                </button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {visibleGroupRows.map((row, index) => renderArtifactCard(
                  row,
                  `${group.id}-${index}`,
                  'min-w-0 grow basis-full @[400px]/artifacts:basis-[calc((100%-0.5rem)/2)] @[560px]/artifacts:basis-[calc((100%-1rem)/3)] @[720px]/artifacts:basis-[calc((100%-1.5rem)/4)]',
                ))}
              </ul>
              {remainingGroupRows > 0 && (
                <button
                  type="button"
                  onClick={() => setGroupLimits(prev => ({ ...prev, [group.id]: limit + GROUP_PAGE_SIZE }))}
                  className="mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('chat.artifactShowMore', { count: remainingGroupRows })}
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </div>
          )
        })}

        {expanded && remainingCount > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setVisibleLimit(value => value + EXPANDED_PAGE_SIZE)}
              className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('chat.artifactShowMore', { count: remainingCount })}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}

        {showExpandToggle && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(value => {
              const next = !value
              if (next) {
                // When every top-level card (featured + folder groups) is already shown in the collapsed row,
                // "View all deliverables" opens the full file grid directly so the click immediately reveals files.
                if (organized.hasGroups && organized.shelfItems.length <= COLLAPSED_MAX_ITEMS) {
                  setViewMode('flat')
                }
              } else {
                setViewMode('grouped')
                setActiveCategory('all')
                setVisibleLimit(EXPANDED_PAGE_SIZE)
                setOpenGroupIds(new Set())
              }
              return next
            })}
            className={cn(
              'mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !organized.hasGroups && (
                organized.shelfItems.length <= 2 ? '@[400px]/artifacts:hidden'
                  : organized.shelfItems.length === 3 ? '@[560px]/artifacts:hidden'
                    : organized.shelfItems.length === 4 ? '@[720px]/artifacts:hidden' : undefined
              ),
            )}
          >
            {expanded ? t('chat.collapseArtifacts') : t('chat.viewAllArtifacts', { count: totalCount })}
            {expanded ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
          </button>
        )}
      </section>
    </TooltipProvider>
  )
}

/** Live file row for a turn whose reply card is not showing the deliverable shelf. */
export function ArtifactSupplementShelf({ anchors, versions, onOpenFile, onOpenArtifact, frameClassName }: {
  anchors: readonly string[]
  versions?: import('@craft-agent/core').Message['artifactVersions']
  onOpenFile?: (path: string) => void
  onOpenArtifact?: OpenArtifactFn
  frameClassName?: string
}) {
  const supplements = useArtifactSupplements()
  if (supplements.length === 0) return null
  const artifacts = extractDeliveredResponseArtifacts(versions)
  if (!mergeArtifactSupplements(artifacts, supplements, anchors, 'pending').some(row => row.supplement)) return null
  const shelf = <ResponseArtifacts artifacts={artifacts} versions={versions} anchors={anchors} mode="pending" onOpenFile={onOpenFile} onOpenArtifact={onOpenArtifact} />
  return frameClassName ? <div className={frameClassName}>{shelf}</div> : shelf
}
