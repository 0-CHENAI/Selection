import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Layers3, MoreHorizontal, Palette, PanelRight, Square } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuSub,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from '@craft-agent/ui'
import { ArtifactSupplementShelf, ArtifactSupplementsProvider, type ArtifactSupplement } from '@craft-agent/ui/chat'
import type { PptChartFallback, PptPageProgress, PptRevision, PptRun } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { cn } from '@/lib/utils'
import { requestOfficePreviewReveal } from '../../lib/office-preview-page'
import { usePptCatalog } from './usePptCatalog'
import { usePptRevisionSend } from './ppt-revision'
import { PptRevisionPanel } from './PptRevisionPanel'
import {
  attentionPageNumbers,
  checkSummary,
  formatAttentionPages,
  pptLiveFrame,
  pptRowFraction,
} from './ppt-result-model'
import { pptSessionAnchor, pptShelfTarget } from './ppt-artifact-shelf'
import { usePptSlideThumbs } from './usePptSlideThumbs'

const REASON_KEY = {
  error: 'ppt.result.chartFallback.error',
  missing: 'ppt.result.chartFallback.missing',
  timeout: 'ppt.result.chartFallback.timeout',
} as const

const NO_SUPPLEMENTS: readonly ArtifactSupplement[] = []

function progressSignature(progress: Session['pptProgress']): string {
  if (!progress) return ''
  return JSON.stringify({
    fileName: progress.fileName,
    pptxPath: progress.pptxPath,
    total: progress.total,
    completed: progress.completed,
    current: progress.current,
    currentTitle: progress.currentTitle,
    generating: progress.generating,
    templateId: progress.templateId,
    themeId: progress.themeId,
    run: progress.run,
    aspect: progress.aspect,
    pages: progress.pages?.map(page => [page.index, page.id, page.name, page.status, page.failed ? 1 : 0, page.issue ?? '', page.issueCount]),
    charts: progress.chartFallbacks,
  })
}

function messageAnchorKey(messages: Session['messages'] | undefined): string {
  if (!messages?.length) return ''
  let key = ''
  for (const message of messages) {
    const paths = message.artifactVersions?.map(item => item.path).join(',') ?? ''
    key += `${message.id}|${message.role}|${message.turnId ?? ''}|${message.answerRunId ?? ''}|${message.isQueued ? 1 : 0}|${paths}\n`
  }
  return key
}

function pageStatusKey(page: PptPageProgress): 'ppt.result.failedShort' | 'ppt.result.attentionShort' | 'ppt.result.passed' | 'ppt.result.fixing' | 'ppt.result.pending' {
  if (page.failed) return 'ppt.result.failedShort'
  if (page.status === 'needs_revision') return 'ppt.result.attentionShort'
  if (page.status === 'passed') return 'ppt.result.passed'
  if (page.status === 'fixing') return 'ppt.result.fixing'
  return 'ppt.result.pending'
}

export function PptArtifactMeta({
  generating,
  total,
  current,
  currentTitle,
  pages,
  run,
  onOpen,
}: {
  generating: boolean
  total: number
  current?: number
  currentTitle?: string
  pages: PptPageProgress[]
  run?: PptRun
  onOpen: (page: number) => void
}) {
  const { t, i18n } = useTranslation()
  const action = run?.action === 'recolor'
    ? t('ppt.result.recoloring')
    : run?.action === 'restyle'
      ? t('ppt.result.restyling')
      : run?.action === 'revise'
        ? t('ppt.result.revising')
        : t('ppt.result.generatingShort')
  if (generating) {
    const title = current ? (currentTitle || pages.find(page => page.index === current)?.name || '').trim() : ''
    const line = current && total > 0
      ? title
        ? t('ppt.result.liveLineTitle', { action, current, total, title })
        : t('ppt.result.liveLine', { action, current, total })
      : action
    return <span data-testid="ppt-artifact-meta">{line}</span>
  }
  const head = [t('ppt.result.format'), total > 0 ? t('ppt.pages', { count: total }) : ''].filter(Boolean).join(' · ')
  const flagged = pages.filter(page => page.failed || page.status === 'needs_revision')
  if (flagged.length > 0) {
    const label = flagged.length > 3
      ? t('ppt.result.attentionCount', { count: flagged.length })
      : t('ppt.result.attentionPages', { pages: formatAttentionPages(flagged.map(page => page.index), i18n.language) })
    const failed = flagged.some(page => page.failed)
    return <span data-testid="ppt-artifact-meta">{head}{' · '}<button type="button" data-testid="ppt-artifact-attention" className={cn('rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', failed ? 'text-[var(--destructive-text)]' : 'text-[var(--info-text)]')} onClick={event => { event.stopPropagation(); onOpen(flagged[0]!.index) }}>{label}</button></span>
  }
  if (pages.length > 0 && pages.every(page => page.status === 'passed' && !page.failed)) {
    return <span data-testid="ppt-artifact-meta" className="inline-flex max-w-full min-w-0 items-center gap-1"><span className="truncate">{head}</span><CheckCircle2 aria-hidden="true" className="size-3 shrink-0 text-[var(--success-text)]" /><span className="truncate text-[var(--success-text)]">{t('ppt.result.allPassed')}</span></span>
  }
  return <span data-testid="ppt-artifact-meta">{head}</span>
}

export function PptArtifactMenuItems({
  pages,
  chartFallbacks,
  canRevise,
  onRestyle,
  onRecolor,
  onOpen,
}: {
  pages: PptPageProgress[]
  chartFallbacks?: PptChartFallback[]
  canRevise: boolean
  onRestyle: () => void
  onRecolor: () => void
  onOpen: (page: number) => void
}) {
  const { t } = useTranslation()
  const summary = checkSummary(pages)
  const noticed = attentionPageNumbers(pages).length
  const openPanel = (panel: 'style' | 'color') => {
    const show = () => panel === 'style' ? onRestyle() : onRecolor()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(show)
    else show()
  }
  return <>
    {canRevise && <StyledDropdownMenuItem data-testid="ppt-artifact-restyle" onSelect={() => openPanel('style')}><Layers3 />{t('ppt.result.restyleMenu')}</StyledDropdownMenuItem>}
    {canRevise && <StyledDropdownMenuItem data-testid="ppt-artifact-recolor" onSelect={() => openPanel('color')}><Palette />{t('ppt.result.recolorMenu')}</StyledDropdownMenuItem>}
    {pages.length > 0 && <DropdownMenuSub>
      <StyledDropdownMenuSubTrigger data-testid="ppt-artifact-checks" className="[&>svg]:!ml-2">
        <span>{t('ppt.result.pageCheck')}</span>
        <span className="ml-auto pl-3 text-muted-foreground">{t('ppt.result.checkCounts', { passed: summary.passed, attention: noticed })}</span>
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {pages.map(page => <StyledDropdownMenuItem key={`${page.index}-${page.id}`} data-testid="ppt-artifact-page" data-page={page.index} title={page.issue} onSelect={() => onOpen(page.index)}>
          <span className="min-w-0 max-w-64 truncate">{t('ppt.result.pageLabel', { page: page.index })}{page.name ? ` ${page.name}` : ''}</span>
          <span className={cn('ml-auto pl-3', page.failed ? 'text-[var(--destructive-text)]' : page.status === 'needs_revision' ? 'text-[var(--info-text)]' : 'text-muted-foreground')}>{t(pageStatusKey(page))}</span>
        </StyledDropdownMenuItem>)}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>}
    {chartFallbacks?.map((item, index) => <StyledDropdownMenuItem key={`${item.skill}-${item.page ?? 'deck'}-${index}`} disabled className="whitespace-normal text-xs text-muted-foreground">
      {t('ppt.result.chartFallback', { where: item.page ? t('ppt.result.chartFallback.page', { page: item.page }) : '', skill: item.skill, reason: t(REASON_KEY[item.reason]) })}
    </StyledDropdownMenuItem>)}
  </>
}

function PptArtifactTrailing({
  standardItems,
  generating,
  canStop,
  pages,
  total,
  completed,
  current,
  sessionFolder,
  templateId,
  themeId,
  chartFallbacks,
  onStop,
  onOpen,
  onApply,
}: {
  standardItems: ReactNode
  generating: boolean
  canStop: boolean
  pages: PptPageProgress[]
  total: number
  completed: number
  current?: number
  sessionFolder?: string
  templateId?: string
  themeId?: string
  chartFallbacks?: PptChartFallback[]
  onStop?: () => void
  onOpen: (page: number) => void
  onApply?: (text: string, revision: PptRevision) => void
}) {
  const { t } = useTranslation()
  const { catalog } = usePptCatalog()
  const thumbs = usePptSlideThumbs(sessionFolder, pages)
  const [panel, setPanel] = useState<'style' | 'color' | null>(null)
  useEffect(() => { if (generating) setPanel(null) }, [generating])
  const frame = pptLiveFrame({ generating, total, completed, current })
  const coverIndex = frame.current ?? attentionPageNumbers(pages)[0] ?? 1
  const coverUrl = thumbs[coverIndex] || (frame.current && frame.current > 1 ? thumbs[frame.current - 1] : undefined) || thumbs[1]
  if (generating) {
    if (!canStop || !onStop) return null
    return <button type="button" data-testid="ppt-artifact-stop" className="mr-2 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-foreground/80 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onStop}>
      <Square aria-hidden="true" className="size-3.5" />{t('ppt.result.stop')}
    </button>
  }
  const apply = (id: string) => {
    if (!panel || !onApply) return
    const revision: PptRevision = panel === 'style'
      ? { action: 'restyle', targets: [], templateId: id }
      : { action: 'recolor', targets: [], themeId: id }
    onApply(t(panel === 'style' ? 'ppt.result.restyle' : 'ppt.result.recolor'), revision)
    setPanel(null)
  }
  return <Popover open={panel !== null} onOpenChange={open => { if (!open) setPanel(null) }}>
    <PopoverAnchor asChild>
      <div className="flex shrink-0 items-center">
        <button type="button" data-testid="ppt-artifact-open-right" aria-label={t('ppt.result.openRight')} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/70 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(coverIndex)}>
          <PanelRight aria-hidden="true" className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="ppt-artifact-menu" aria-label={t('ppt.result.moreActions')} className="mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end">
            <PptArtifactMenuItems pages={pages} chartFallbacks={chartFallbacks} canRevise={!!onApply} onRestyle={() => setPanel('style')} onRecolor={() => setPanel('color')} onOpen={onOpen} />
            {standardItems}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </div>
    </PopoverAnchor>
    <PopoverContent align="end" className="w-[24rem] max-w-[calc(100vw-2rem)] p-3">
      {panel && <PptRevisionPanel key={`${panel}:${templateId ?? ''}:${themeId ?? ''}`} tab={panel} onTab={setPanel} templates={catalog?.templates ?? []} themes={catalog?.themes ?? []} currentTemplateId={templateId} currentThemeId={themeId} coverUrl={coverUrl} total={total} onApply={apply} onCancel={() => setPanel(null)} />}
    </PopoverContent>
  </Popover>
}

function usePptArtifactSupplements(session: Session | null): readonly ArtifactSupplement[] {
  const send = usePptRevisionSend()
  const sendRef = useRef(send)
  sendRef.current = send
  const [pending, setPending] = useState<PptRun | undefined>()
  const progress = session?.pptProgress
  const generating = !!session?.isProcessing || !!progress?.generating
  const wasGenerating = useRef(false)
  useEffect(() => {
    if (wasGenerating.current && !generating) setPending(undefined)
    if (generating && progress?.run) setPending(undefined)
    wasGenerating.current = generating
  }, [generating, progress?.run])
  const identity = [
    session?.id ?? '',
    session?.ppt ? 1 : 0,
    session?.sessionFolderPath ?? '',
    generating ? 1 : 0,
    session?.isProcessing ? 1 : 0,
    messageAnchorKey(session?.messages),
    progressSignature(progress),
    pending?.action ?? '',
    pending?.templateId ?? '',
    pending?.themeId ?? '',
  ].join('\u0001')
  const supplement = useMemo(() => {
    if (!session?.ppt || !session) return null
    const total = progress?.total ?? 0
    const fileName = progress?.fileName
    if (!generating && total <= 0 && !fileName) return null
    const pages = progress?.pages ?? []
    const target = pptShelfTarget(session.id, session.messages, progress?.pptxPath)
    const anchors = target.anchors.length ? target.anchors : [pptSessionAnchor(session.id)]
    const frame = pptLiveFrame({ generating, total, completed: progress?.completed ?? 0, current: progress?.current })
    const attention = attentionPageNumbers(pages)
    const openAt = frame.current ?? attention[0] ?? 1
    const run = progress?.run ?? (generating ? pending : undefined)
    const path = progress?.pptxPath
    const reveal = (page: number) => requestOfficePreviewReveal({ sessionId: session.id, ...(path ? { path } : {}), page })
    return {
      path: path || `ppt-pending:${session.id}`,
      name: fileName || 'slides.pptx',
      extension: 'pptx',
      pendingAnchors: target.listed ? [] : anchors,
      applyAnchors: anchors,
      progress: pptRowFraction({ generating, total, completed: progress?.completed ?? 0, current: progress?.current }),
      testId: 'ppt-artifact-row',
      onActivate: () => reveal(openAt),
      meta: <PptArtifactMeta generating={generating} total={total} current={frame.current} currentTitle={progress?.currentTitle} pages={pages} run={run} onOpen={reveal} />,
      trailing: (standardItems: ReactNode) => <PptArtifactTrailing
        standardItems={standardItems}
        generating={generating}
        canStop={!!session.isProcessing}
        pages={pages}
        total={total}
        completed={progress?.completed ?? 0}
        current={progress?.current}
        sessionFolder={session.sessionFolderPath}
        templateId={progress?.templateId}
        themeId={progress?.themeId}
        chartFallbacks={progress?.chartFallbacks}
        onStop={session.isProcessing ? () => { void window.electronAPI.cancelProcessing(session.id, false) } : undefined}
        onOpen={reveal}
        onApply={sendRef.current ? (text, revision) => {
          setPending({ action: revision.action ?? 'revise', ...(revision.templateId ? { templateId: revision.templateId } : {}), ...(revision.themeId ? { themeId: revision.themeId } : {}) })
          void sendRef.current?.(text, revision).then(ok => { if (!ok) setPending(undefined) })
        } : undefined}
      />,
    } satisfies ArtifactSupplement
    // The identity string covers every field this row reads. `session` itself changes on each token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
  return useMemo(() => supplement ? [supplement] : NO_SUPPLEMENTS, [supplement])
}

export function PptArtifactScope({ session, children }: { session: Session | null; children: ReactNode }) {
  const supplements = usePptArtifactSupplements(session)
  return <ArtifactSupplementsProvider supplements={supplements}>{children}</ArtifactSupplementsProvider>
}

/** Shown above the composer only until an assistant turn exists to host the row. */
export function PptSessionArtifactShelf({ sessionId, onOpenFile, onOpenArtifact }: {
  sessionId?: string
  onOpenFile?: (path: string) => void
  onOpenArtifact?: (path: string, action: 'preview' | 'external' | 'reveal' | 'versions', versionId?: string, artifactId?: string) => void | boolean | Promise<void | boolean>
}) {
  if (!sessionId) return null
  return <ArtifactSupplementShelf
    anchors={[pptSessionAnchor(sessionId)]}
    onOpenFile={onOpenFile}
    onOpenArtifact={onOpenArtifact}
    frameClassName="mx-auto mb-2 w-full max-w-[840px] px-5"
  />
}
