import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, FolderOpen, Layers3, LoaderCircle, Palette, PanelRight, Square } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, FileTypeIcon, StyledDropdownMenuContent, StyledDropdownMenuItem, usePlatform } from '@craft-agent/ui'
import type { PptChartFallback, PptPageProgress, PptRevision, PptRun, PptTemplate, PptTheme } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { AnimatedCollapsibleContent } from '../ui/collapsible'
import { cn } from '@/lib/utils'
import { requestOfficePreviewPage } from '../../lib/office-preview-page'
import { usePptCatalog } from './usePptCatalog'
import { usePptRevisionSend } from './ppt-revision'
import { PptRevisionPanel } from './PptRevisionPanel'
import { attentionCount, checkSummary, pptLiveFrame, segmentState, thumbBarClass, thumbDimmed } from './ppt-result-model'
import { pptResultMessageId, usePptResultExpanded } from './ppt-result-fold'
import { usePptSlideThumbs } from './usePptSlideThumbs'

const REASON_KEY = {
  error: 'ppt.result.chartFallback.error',
  missing: 'ppt.result.chartFallback.missing',
  timeout: 'ppt.result.chartFallback.timeout',
} as const

function Swatches({ colors }: { colors: string[] }) {
  return <span className="inline-flex items-center">
    {colors.map((color, index) => <span key={`${color}-${index}`} className="-ml-0.5 size-2.5 rounded-full ring-1 ring-foreground/15 first:ml-0" style={{ background: color }} />)}
  </span>
}

/** Known deck ratios. Anything else stays 16:9, and the bitmap is never cropped. */
function frameRatio(aspect?: string): string | undefined {
  if (!aspect || aspect === '16:9') return undefined
  if (aspect === 'A4') return '210 / 297'
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect)
  return match ? `${match[1]} / ${match[2]}` : undefined
}

export interface PptResultViewProps {
  fileName?: string
  pptxPath?: string
  total: number
  completed: number
  current?: number
  currentTitle?: string
  generating: boolean
  canStop: boolean
  pages: PptPageProgress[]
  aspect?: string
  thumbs: Record<number, string>
  templateTitle?: string
  themeName?: string
  theme?: PptTheme
  templates: PptTemplate[]
  themes: PptTheme[]
  currentTemplateId?: string
  currentThemeId?: string
  run?: PptRun
  chartFallbacks?: PptChartFallback[]
  fileManagerName?: string
  initialPanel?: 'style' | 'color' | null
  /** Absent means collapsed. The card stores an expand only after the user toggles it. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  onPick: (page: number) => void
  onOpenRight: (page: number) => void
  onStop?: () => void
  onApply?: (text: string, revision: PptRevision) => void
  onOpenExternal?: (path: string) => void
  onReveal?: (path: string) => void
}

export function PptResultView({
  fileName,
  pptxPath,
  total,
  completed,
  current,
  currentTitle,
  generating,
  canStop,
  pages,
  aspect,
  thumbs,
  templateTitle,
  themeName,
  theme,
  templates,
  themes,
  currentTemplateId,
  currentThemeId,
  run,
  chartFallbacks,
  fileManagerName,
  initialPanel = null,
  expanded: expandedProp,
  onExpandedChange,
  onPick,
  onOpenRight,
  onStop,
  onApply,
  onOpenExternal,
  onReveal,
}: PptResultViewProps) {
  const { t } = useTranslation()
  const bodyId = useId()
  const reduceMotion = !!useReducedMotion()
  const [panel, setPanel] = useState<'style' | 'color' | null>(initialPanel)
  const [picked, setPicked] = useState<number | null>(null)
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false)
  const expanded = expandedProp ?? uncontrolledExpanded
  const setExpanded = (next: boolean) => {
    onExpandedChange?.(next)
    if (expandedProp === undefined) setUncontrolledExpanded(next)
  }
  const frame = pptLiveFrame({ generating, total, completed, current })
  const coverIndex = frame.current ?? Math.min(Math.max(picked ?? 1, 1), Math.max(total, 1))
  const coverUrl = thumbs[coverIndex] || (frame.current && frame.current > 1 ? thumbs[frame.current - 1] : undefined)
  const showVeil = generating && frame.current != null
  const summary = checkSummary(pages)
  const title = fileName || currentTitle || t(generating ? 'ppt.result.generating' : 'ppt.result.format')
  const meta = [t('ppt.result.format'), total > 0 ? t('ppt.pages', { count: total }) : '', aspect ?? '', templateTitle ?? ''].filter(Boolean).join(' · ')
  const headline = run?.action === 'recolor'
    ? t('ppt.result.recoloring')
    : run?.action === 'restyle'
      ? t('ppt.result.restyling')
      : run?.action === 'revise'
        ? t('ppt.result.revising')
        : t('ppt.result.generating')
  const attention = summary.attention
  const attentionText = !attention
    ? ''
    : attention.failed
      ? t('ppt.result.failedPage', { page: attention.index, reason: attention.issue ?? '' })
      : attention.issue
        ? t('ppt.result.needsAttention', { page: attention.index, reason: attention.issue })
        : t('ppt.result.needsAttentionBare', { page: attention.index })
  const ratio = frameRatio(aspect)
  const noticed = attentionCount(pages)
  const foldStatus = total <= 0
    ? ''
    : generating
      ? t('ppt.result.foldProgress', { count: total, completed: frame.completed, total })
      : noticed > 0
        ? t('ppt.result.foldAttention', { count: total, attention: noticed })
        : t('ppt.result.foldPassed', { count: total })
  const apply = (id: string) => {
    if (!panel || !onApply) return
    const revision: PptRevision = panel === 'style'
      ? { action: 'restyle', targets: [], templateId: id }
      : { action: 'recolor', targets: [], themeId: id }
    onApply(t(panel === 'style' ? 'ppt.result.restyle' : 'ppt.result.recolor'), revision)
    setPanel(null)
  }
  const toggleExpanded = () => {
    if (expanded) setPanel(null)
    setExpanded(!expanded)
  }
  const segments = (thin: boolean) => total > 0 && <div className="mt-2 flex gap-0.5" data-testid={thin ? 'ppt-result-fold-bar' : 'ppt-result-segments'}>
    {Array.from({ length: total }, (_, offset) => {
      const state = segmentState(offset + 1, frame.current)
      return <span key={offset + 1} data-testid="ppt-result-segment" data-state={state} className={cn(thin ? 'h-1' : 'h-1.5', 'flex-1 rounded-sm', state === 'done' ? 'bg-accent' : state === 'current' ? 'bg-accent/45' : 'bg-foreground/10')} />
    })}
  </div>
  const openRight = <button type="button" data-testid="ppt-result-open-right" disabled={!pptxPath} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] text-foreground/80 hover:bg-foreground/5 disabled:opacity-40" onClick={() => onOpenRight(coverIndex)}>
    <PanelRight aria-hidden="true" className="size-3.5" />{t('ppt.result.openRight')}
  </button>
  const body = <>
    <div data-testid="ppt-result-cover" data-page={coverIndex} className={cn('relative mt-3 w-full overflow-hidden rounded-lg bg-foreground/5', !ratio && 'aspect-video')} style={ratio ? { aspectRatio: ratio } : undefined}>
      {coverUrl && <img alt="" src={coverUrl} className="h-full w-full object-contain" />}
      {showVeil && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/45 text-sm text-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        <span>{t('ppt.result.pageVeil', { page: frame.current })}</span>
      </div>}
      {!generating && total > 0 && <span className="absolute right-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] tabular-nums text-foreground/80">{t('ppt.result.pageOf', { current: coverIndex, total })}</span>}
    </div>
    {generating ? <div data-testid="ppt-result-live" className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          <span className="truncate">{headline}</span>
        </span>
        {canStop && onStop && <button type="button" data-testid="ppt-result-stop" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-foreground/80 hover:bg-foreground/5" onClick={onStop}>
          <Square aria-hidden="true" className="size-3.5" />{t('ppt.result.stop')}
        </button>}
      </div>
      {run?.action === 'recolor' && <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {theme && <Swatches colors={[theme.paper, theme.ink, theme.accent, theme.signal].filter((color): color is string => !!color)} />}
        <span className="truncate">{[themeName, t('ppt.result.layoutSame')].filter(Boolean).join(' · ')}</span>
      </p>}
      {run?.action === 'restyle' && <p className="mt-1 truncate text-xs text-muted-foreground">{[templateTitle, t('ppt.result.copySame')].filter(Boolean).join(' · ')}</p>}
      {segments(false)}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{t('ppt.result.completedCount', { completed: frame.completed, total })}</span>
        <span>{t('ppt.result.liveRefresh')}</span>
      </div>
    </div> : total > 0 && <div data-testid="ppt-result-summary" className="mt-2 space-y-1 text-xs">
      <p className="flex items-center gap-1.5 text-[var(--success-text)]"><CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />{t('ppt.result.passedCount', { count: summary.passed })}</p>
      {attention && <p className={cn('flex min-w-0 items-center gap-1.5', attention.failed ? 'text-[var(--destructive-text)]' : 'text-[var(--info-text)]')}><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{attentionText}</span></p>}
    </div>}
    {chartFallbacks?.map((item, index) => <p key={`${item.skill}-${item.page ?? 'deck'}-${index}`} className="mt-2 truncate text-xs text-muted-foreground">{t('ppt.result.chartFallback', { where: item.page ? t('ppt.result.chartFallback.page', { page: item.page }) : '', skill: item.skill, reason: t(REASON_KEY[item.reason]) })}</p>)}
    {pages.length > 0 && <div className="mt-3 flex flex-nowrap gap-1 overflow-x-auto p-1">
      {pages.map(page => {
        const selected = page.index === coverIndex
        return <button key={`${page.index}-${page.id}`} type="button" data-testid="ppt-result-thumb" data-page={page.index} data-status={page.status} title={page.name} aria-label={page.name} aria-current={selected || undefined} className={cn('min-w-11 flex-1 basis-0 rounded-sm border-2 border-transparent', selected && 'border-accent')} onClick={() => { setPicked(page.index); onPick(page.index) }}>
          <span className={cn('block w-full overflow-hidden rounded-sm bg-foreground/5', !ratio && 'aspect-video', thumbDimmed(page, generating, frame.current) && 'opacity-40')} style={ratio ? { aspectRatio: ratio } : undefined}>
            {thumbs[page.index] && <img alt="" src={thumbs[page.index]} className="h-full w-full object-contain" />}
          </span>
          <span data-testid="ppt-result-bar" className={cn('mt-1 block h-[2.5px] rounded-full', thumbBarClass(page, generating, frame.current))} />
        </button>
      })}
    </div>}
    <Popover open={panel !== null} onOpenChange={open => { if (!open) setPanel(null) }}>
      <PopoverAnchor asChild>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {openRight}
          {onApply && <>
            <button type="button" data-testid="ppt-result-restyle" disabled={generating} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-foreground/80 hover:bg-foreground/5 disabled:opacity-40" onClick={() => setPanel(panel === 'style' ? null : 'style')}>
              <Layers3 aria-hidden="true" className="size-3.5" />{t('ppt.result.restyle')}
            </button>
            <button type="button" data-testid="ppt-result-recolor" disabled={generating} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-foreground/80 hover:bg-foreground/5 disabled:opacity-40" onClick={() => setPanel(panel === 'color' ? null : 'color')}>
              <Palette aria-hidden="true" className="size-3.5" />{t('ppt.result.recolor')}
            </button>
          </>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-testid="ppt-result-open-with" disabled={generating || !pptxPath} aria-label={t('chat.artifactOpenWith')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40">
                {t('chat.artifactOpenWith')}<ChevronDown aria-hidden="true" className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end">
              <StyledDropdownMenuItem disabled={!pptxPath} onSelect={() => { if (pptxPath) onOpenExternal?.(pptxPath) }}>
                <ExternalLink />{t('chat.artifactOfficeApp', { app: 'PowerPoint' })}
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem disabled={!pptxPath} onSelect={() => { if (pptxPath) onReveal?.(pptxPath) }}>
                <FolderOpen />{t('chat.showInFileManager', { fileManager: fileManagerName || t('chat.artifactFileManager') })}
              </StyledDropdownMenuItem>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-[24rem] max-w-[calc(100vw-2rem)] p-3">
        {panel && <PptRevisionPanel key={`${panel}:${currentTemplateId ?? ''}:${currentThemeId ?? ''}`} tab={panel} onTab={setPanel} templates={templates} themes={themes} currentTemplateId={currentTemplateId} currentThemeId={currentThemeId} coverUrl={coverUrl} total={total} onApply={apply} onCancel={() => setPanel(null)} />}
      </PopoverContent>
    </Popover>
  </>
  const instant = reduceMotion || typeof window === 'undefined'
  return <div data-testid="ppt-result-card" data-expanded={expanded ? 'true' : 'false'} className="mx-auto mb-2 w-full max-w-[840px] px-5">
    <div className="rounded-xl bg-foreground/[0.04] p-3">
      <div className="flex items-center gap-2">
        <FileTypeIcon fileName={fileName || 'slides.pptx'} className="size-6 shrink-0" />
        <div className={cn('min-w-0', expanded ? 'flex-1' : 'shrink')}>
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          {expanded && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
        </div>
        {!expanded && foldStatus && <span data-testid="ppt-result-fold-status" className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{foldStatus}</span>}
        {!expanded && openRight}
        <button
          type="button"
          data-testid="ppt-result-fold"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? t('ppt.result.collapse') : t('ppt.result.expand')}
          title={expanded ? t('ppt.result.collapse') : t('ppt.result.expand')}
          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/70 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={toggleExpanded}
        >
          {expanded ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
        </button>
      </div>
      {!expanded && generating && segments(true)}
      <div id={bodyId} aria-hidden={!expanded} data-motion={instant ? 'off' : 'on'}>
        {instant ? expanded && body : <AnimatedCollapsibleContent isOpen={expanded} className="overflow-hidden">{body}</AnimatedCollapsibleContent>}
      </div>
    </div>
  </div>
}

export function PptResultCard({ session }: { session: Session | null }) {
  const send = usePptRevisionSend()
  const { catalog } = usePptCatalog()
  const { onOpenFileExternal, onRevealInFinder, fileManagerName } = usePlatform()
  const [pending, setPending] = useState<PptRun | undefined>()
  const progress = session?.pptProgress
  const generating = !!session?.isProcessing || !!progress?.generating
  const wasGenerating = useRef(false)
  useEffect(() => {
    if (wasGenerating.current && !generating) setPending(undefined)
    if (generating && progress?.run) setPending(undefined)
    wasGenerating.current = generating
  }, [generating, progress?.run])
  const total = progress?.total ?? 0
  const pages = progress?.pages ?? []
  const thumbs = usePptSlideThumbs(session?.sessionFolderPath, pages)
  const messageId = pptResultMessageId(session?.messages)
  const [expanded, setExpanded] = usePptResultExpanded(session?.id, messageId)
  if (!session?.ppt || (!generating && total <= 0 && !progress?.fileName)) return null
  const run = progress?.run ?? (generating ? pending : undefined)
  const templateId = run?.templateId ?? progress?.templateId
  const themeId = run?.themeId ?? progress?.themeId
  const template = catalog?.templates.find(item => item.id === templateId)
  const theme = catalog?.themes.find(item => item.id === themeId)
  const palette = progress?.palette
  const paletteTheme = !theme && palette
    ? { id: themeId ?? 'current', name: '', paper: palette.paper, ink: palette.ink, accent: palette.accent, signal: palette.signal ?? palette.accent }
    : undefined
  return <PptResultView
    fileName={progress?.fileName}
    pptxPath={progress?.pptxPath}
    total={total}
    completed={progress?.completed ?? 0}
    current={progress?.current}
    currentTitle={progress?.currentTitle}
    generating={generating}
    canStop={!!session.isProcessing}
    pages={pages}
    aspect={progress?.aspect}
    thumbs={thumbs}
    templateTitle={template?.title}
    themeName={theme?.name}
    theme={theme ?? paletteTheme}
    templates={catalog?.templates ?? []}
    themes={catalog?.themes ?? []}
    currentTemplateId={progress?.templateId}
    currentThemeId={progress?.themeId}
    run={run}
    chartFallbacks={progress?.chartFallbacks}
    fileManagerName={fileManagerName}
    expanded={expanded}
    onExpandedChange={setExpanded}
    onPick={page => { if (progress?.pptxPath) requestOfficePreviewPage({ sessionId: session.id, path: progress.pptxPath, page }) }}
    onOpenRight={page => { if (progress?.pptxPath) requestOfficePreviewPage({ sessionId: session.id, path: progress.pptxPath, page }) }}
    onStop={session.isProcessing ? () => { void window.electronAPI.cancelProcessing(session.id, false) } : undefined}
    onApply={send ? (text, revision) => {
      setPending({ action: revision.action ?? 'revise', ...(revision.templateId ? { templateId: revision.templateId } : {}), ...(revision.themeId ? { themeId: revision.themeId } : {}) })
      void send(text, revision).then(ok => { if (!ok) setPending(undefined) })
    } : undefined}
    onOpenExternal={path => { onOpenFileExternal?.(path) }}
    onReveal={path => { onRevealInFinder?.(path) }}
  />
}
