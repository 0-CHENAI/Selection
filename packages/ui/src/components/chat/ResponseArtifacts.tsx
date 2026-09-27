import * as React from 'react'
import { AlertTriangle, ExternalLink, FolderOpen, ChevronDown, ChevronUp, GitCommitHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileTypeIcon } from './attachment-helpers'
import type { ResponseArtifact } from './response-artifacts'
import { usePlatform } from '../../context/PlatformContext'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '../ui/StyledDropdown'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

function officeAppName(extension: string): string | undefined {
  if (/^(docx?|docm|dotx?|dotm|rtf)$/.test(extension)) return 'Word'
  if (/^(xlsx?|xlsm|xlsb|xltx?|xltm|csv)$/.test(extension)) return 'Excel'
  if (/^(pptx?|pptm|potx?|potm|ppsx?|ppsm)$/.test(extension)) return 'PowerPoint'
  return undefined
}

/** Compact delivery shelf, outside the annotated reply body and above message actions. */
export function ResponseArtifacts({ artifacts, versions, onOpenFile, onOpenArtifact }: {
  artifacts: ResponseArtifact[]
  versions?: import('@craft-agent/core').Message['artifactVersions']
  onOpenFile?: (path: string) => void
  onOpenArtifact?: (path: string, action: 'preview' | 'external' | 'reveal' | 'versions') => void | boolean | Promise<void | boolean>
}) {
  const { t } = useTranslation()
  const { onManageArtifact, onOpenFileExternal, onRevealInFinder, fileManagerName } = usePlatform()
  const [expanded, setExpanded] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(new Set<string>())
  const openRequests = React.useRef(new Map<string, number>())
  const listId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const wasExpanded = React.useRef(false)
  const open = async (path: string, action: 'preview' | 'external' | 'reveal' | 'versions') => {
    const request = (openRequests.current.get(path) ?? 0) + 1
    if (action !== 'versions') openRequests.current.set(path, request)
    let succeeded = false
    try {
      const result = onOpenArtifact ? await onOpenArtifact(path, action)
        : action === 'external' ? await onOpenFileExternal?.(path)
          : action === 'reveal' ? await onRevealInFinder?.(path) : await onOpenFile?.(path)
      succeeded = result !== false
    } catch { /* Keep the error on the artifact after transient notifications disappear. */ }
    if (action === 'versions' || openRequests.current.get(path) !== request) return
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
  if (artifacts.length === 0) return null
  return (
    <TooltipProvider>
      <section ref={sectionRef} aria-label={t('chat.artifacts')} className="@container/artifacts px-4 pb-3 pt-1">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t('chat.artifacts')}</div>
        {/* Container queries keep the row limit in sync; flex growth fills incomplete rows. */}
        <ul id={listId} className="flex flex-wrap gap-2">
          {artifacts.map((artifact, index) => {
            const version = versions?.find(item => item.path === artifact.path)
            return (
            <li key={artifact.path} className={cn('min-w-0 grow basis-full @[400px]/artifacts:basis-[calc((100%-0.5rem)/2)] @[560px]/artifacts:basis-[calc((100%-1rem)/3)] @[720px]/artifacts:basis-[calc((100%-1.5rem)/4)]', !expanded && index > 0 && (
              index === 1 ? 'hidden @[400px]/artifacts:block'
                : index === 2 ? 'hidden @[560px]/artifacts:block'
                  : index === 3 ? 'hidden @[720px]/artifacts:block' : 'hidden'
            ))}>
              <div className="flex min-w-0 items-center rounded-xl bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.07] has-[[data-state=open]]:bg-foreground/[0.07]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={!onOpenArtifact && !onOpenFile}
                      onClick={() => { void open(artifact.path, 'preview') }}
                      aria-describedby={unavailable.has(artifact.path) ? `${listId}-error-${index}` : undefined}
                      aria-label={`${t('common.open')} ${artifact.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    >
                      <FileTypeIcon fileName={artifact.name} className="size-6" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{artifact.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{artifact.extension.toUpperCase()}</span>
                          {version && <span title={version.versionId} className="inline-flex items-center gap-1 font-mono"><GitCommitHorizontal aria-hidden="true" className="size-3" />v{version.ordinal} · {version.versionId.slice(0, 8)}</span>}
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
                      <button type="button" aria-label={`${t('chat.artifactOpenWith')} ${artifact.name}`} className="mr-2 inline-flex shrink-0 items-center gap-1 border-0 bg-transparent px-1 py-2 text-xs text-muted-foreground shadow-none outline-none hover:text-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:text-foreground">
                        {t('chat.artifactOpenWith')}<ChevronDown aria-hidden="true" className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <StyledDropdownMenuContent align="end">
                      {onManageArtifact && onOpenArtifact && <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'versions') }}><GitCommitHorizontal />{t('chat.artifactVersions.title')}</StyledDropdownMenuItem>}
                      {(onOpenArtifact || onOpenFileExternal) && (
                        <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'external') }}>
                          <ExternalLink />
                          {officeAppName(artifact.extension) ? t('chat.artifactOfficeApp', { app: officeAppName(artifact.extension) }) : t('chat.artifactDefaultApp')}
                        </StyledDropdownMenuItem>
                      )}
                      {(onOpenArtifact || onRevealInFinder) && (
                        <StyledDropdownMenuItem onSelect={() => { void open(artifact.path, 'reveal') }}>
                          <FolderOpen />{t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })}
                        </StyledDropdownMenuItem>
                      )}
                    </StyledDropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {unavailable.has(artifact.path) && <div id={`${listId}-error-${index}`} role="status" className="mt-1 flex flex-wrap items-center gap-1.5 px-2 text-xs text-foreground">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-info" />
                <span>{t('toast.failedToOpenFile')}</span>
                {onManageArtifact && onOpenArtifact && <button type="button" className="underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" onClick={() => { void open(artifact.path, 'versions') }}>{t('chat.artifactVersions.title')}</button>}
              </div>}
            </li>
            )})}
        </ul>
        {artifacts.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(value => !value)}
            className={cn(
              'mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              artifacts.length <= 2 ? '@[400px]/artifacts:hidden'
                : artifacts.length === 3 ? '@[560px]/artifacts:hidden'
                  : artifacts.length === 4 ? '@[720px]/artifacts:hidden' : undefined,
            )}
          >
            {expanded ? t('chat.collapseArtifacts') : t('chat.viewAllArtifacts', { count: artifacts.length })}
            {expanded ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
          </button>
        )}
      </section>
    </TooltipProvider>
  )
}
