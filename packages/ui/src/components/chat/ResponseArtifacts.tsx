import * as React from 'react'
import { AlertTriangle, ExternalLink, FolderOpen, ChevronDown, ChevronUp, Layers3, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileTypeIcon } from './attachment-helpers'
import { mergeArtifactSupplements, useArtifactSupplements } from './artifact-supplements'
import { artifactPathKey, extractDeliveredResponseArtifacts, type ArtifactChange, type ResponseArtifact } from './response-artifacts'
import { usePlatform } from '../../context/PlatformContext'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '../ui/StyledDropdown'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

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

/** Compact delivery shelf, outside the annotated reply body and above message actions. */
export function ResponseArtifacts({ artifacts, versions, onOpenFile, onOpenArtifact, anchors = [], mode = 'settled' }: {
  artifacts: ResponseArtifact[]
  versions?: import('@craft-agent/core').Message['artifactVersions']
  onOpenFile?: (path: string) => void
  onOpenArtifact?: (path: string, action: 'preview' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => void | boolean | Promise<void | boolean>
  /** Identities of this reply. A supplement targets one of them. */
  anchors?: readonly string[]
  /** Pending keeps only live supplemented rows, before the rest of the shelf settles. */
  mode?: 'settled' | 'pending'
}) {
  const { t } = useTranslation()
  const { onManageArtifact, onOpenFileExternal, onRevealInFinder, fileManagerName } = usePlatform()
  const supplements = useArtifactSupplements()
  const [expanded, setExpanded] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(new Set<string>())
  const [openingVersion, setOpeningVersion] = React.useState<string | null>(null)
  const openRequests = React.useRef(new Map<string, number>())
  const versionRequest = React.useRef(0)
  const listId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const wasExpanded = React.useRef(false)
  const open = async (path: string, action: 'preview' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => {
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
  const rows = mergeArtifactSupplements(artifacts, supplements, anchors, mode)
  if (rows.length === 0) return null
  return (
    <TooltipProvider>
      <section ref={sectionRef} aria-label={t('chat.artifacts')} className="@container/artifacts px-2.5 pb-3 pt-1">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t('chat.artifacts')}</div>
        {/* Container queries keep the row limit in sync; flex growth fills incomplete rows.
            Shift by the chip's own padding so the file icon lines up with message actions. */}
        <ul id={listId} className="-ml-3 flex flex-wrap gap-2">
          {rows.map((row, index) => {
            const artifact = row.artifact
            const supplement = row.supplement
            const version = versions?.find(item => artifactPathKey(item.path) === artifactPathKey(artifact.path))
            const change = artifact.change
            const openAction = change === 'deleted' && onOpenArtifact ? 'versions' : 'preview'
            const activate = () => {
              if (supplement?.onActivate) supplement.onActivate()
              else void open(artifact.path, openAction, version?.versionId, version?.artifactId)
            }
            const standardItems = <>
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
            <li key={artifact.path} className={cn('min-w-0 grow basis-full @[400px]/artifacts:basis-[calc((100%-0.5rem)/2)] @[560px]/artifacts:basis-[calc((100%-1rem)/3)] @[720px]/artifacts:basis-[calc((100%-1.5rem)/4)]', !expanded && index > 0 && (
              index === 1 ? 'hidden @[400px]/artifacts:block'
                : index === 2 ? 'hidden @[560px]/artifacts:block'
                  : index === 3 ? 'hidden @[720px]/artifacts:block' : 'hidden'
            ))}>
              <div data-testid={supplement?.testId} className={shellClass} onClick={supplement ? event => {
                const target = event.target
                if (!(target instanceof Element) || target.closest('button, a, [role="menuitem"]')) return
                activate()
              } : undefined}>
                {supplement ? <>
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5">
                    <button type="button" onClick={activate} aria-describedby={unavailable.has(artifact.path) ? `${listId}-error-${index}` : undefined} aria-label={`${t('common.open')} ${artifact.name}`} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                      aria-describedby={unavailable.has(artifact.path) ? `${listId}-error-${index}` : undefined}
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
                {(onOpenArtifact || onOpenFileExternal || onRevealInFinder) && (
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
              {unavailable.has(artifact.path) && <div id={`${listId}-error-${index}`} role="status" className="mt-1 flex flex-wrap items-center gap-1.5 px-2 text-xs text-foreground">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-info" />
                <span>{t('toast.failedToOpenFile')}</span>
                {version && onManageArtifact && onOpenArtifact && <button type="button" className="underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" onClick={() => { void open(artifact.path, 'versions', version.versionId) }}>{t('chat.artifactVersions.title')}</button>}
              </div>}
            </li>
            )})}
        </ul>
        {rows.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(value => !value)}
            className={cn(
              'mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              rows.length <= 2 ? '@[400px]/artifacts:hidden'
                : rows.length === 3 ? '@[560px]/artifacts:hidden'
                  : rows.length === 4 ? '@[720px]/artifacts:hidden' : undefined,
            )}
          >
            {expanded ? t('chat.collapseArtifacts') : t('chat.viewAllArtifacts', { count: rows.length })}
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
  onOpenArtifact?: (path: string, action: 'preview' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => void | boolean | Promise<void | boolean>
  frameClassName?: string
}) {
  const supplements = useArtifactSupplements()
  if (supplements.length === 0) return null
  const artifacts = extractDeliveredResponseArtifacts(versions)
  if (!mergeArtifactSupplements(artifacts, supplements, anchors, 'pending').some(row => row.supplement)) return null
  const shelf = <ResponseArtifacts artifacts={artifacts} versions={versions} anchors={anchors} mode="pending" onOpenFile={onOpenFile} onOpenArtifact={onOpenArtifact} />
  return frameClassName ? <div className={frameClassName}>{shelf}</div> : shelf
}
