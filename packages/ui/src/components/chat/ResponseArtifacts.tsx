import * as React from 'react'
import { ExternalLink, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react'
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
export function ResponseArtifacts({ artifacts, onOpenFile, onOpenArtifact }: {
  artifacts: ResponseArtifact[]
  onOpenFile?: (path: string) => void
  onOpenArtifact?: (path: string, action: 'preview' | 'external' | 'reveal') => void
}) {
  const { t } = useTranslation()
  const { onOpenFileExternal, onRevealInFinder, fileManagerName } = usePlatform()
  const [expanded, setExpanded] = React.useState(false)
  const listId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const wasExpanded = React.useRef(false)
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
          {artifacts.map((artifact, index) => (
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
                      onClick={() => onOpenArtifact
                        ? onOpenArtifact(artifact.path, 'preview')
                        : onOpenFile?.(artifact.path)}
                      aria-label={`${t('common.open')} ${artifact.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    >
                      <FileTypeIcon fileName={artifact.name} className="size-6" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{artifact.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{artifact.extension.toUpperCase()}</span>
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
                      {(onOpenArtifact || onOpenFileExternal) && (
                        <StyledDropdownMenuItem onSelect={() => onOpenArtifact
                          ? onOpenArtifact(artifact.path, 'external')
                          : onOpenFileExternal?.(artifact.path)}>
                          <ExternalLink />
                          {officeAppName(artifact.extension) ? t('chat.artifactOfficeApp', { app: officeAppName(artifact.extension) }) : t('chat.artifactDefaultApp')}
                        </StyledDropdownMenuItem>
                      )}
                      {(onOpenArtifact || onRevealInFinder) && (
                        <StyledDropdownMenuItem onSelect={() => onOpenArtifact
                          ? onOpenArtifact(artifact.path, 'reveal')
                          : onRevealInFinder?.(artifact.path)}>
                          <FolderOpen />{t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })}
                        </StyledDropdownMenuItem>
                      )}
                    </StyledDropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          ))}
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
