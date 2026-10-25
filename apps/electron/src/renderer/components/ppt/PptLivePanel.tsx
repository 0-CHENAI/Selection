import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, LoaderCircle, MousePointer2, X } from 'lucide-react'
import type { PptLivePage, PptLiveSnapshot } from '@craft-agent/shared/protocol'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { cn } from '@/lib/utils'
import { RADIUS_EDGE, RADIUS_INNER } from '@/components/app-shell/panel-constants'
import { applyPptSelection, PPT_LIVE_MAX_SELECTION, pptTargetKey } from './ppt-live-model'
import { getPptSelection, setPptSelection, subscribePptSelection } from './ppt-selection'

const STATUS_KEY = {
  passed: 'ppt.live.passed',
  needs_revision: 'ppt.live.needsRevision',
  fixing: 'ppt.live.fixing',
  pending: '',
} as const

function SlideFrame({ page, canvas, selected, generating, onSelect }: {
  page: PptLivePage
  canvas: PptLiveSnapshot['canvas']
  selected: boolean
  generating: boolean
  onSelect: (target: { page: number; elementId?: string }, toggle: boolean) => void
}) {
  return <div data-page={page.index} className={cn('relative overflow-hidden rounded-[2px] bg-white shadow-middle', selected && 'ring-2 ring-[#2563EB]')}
    onClick={event => { if (generating) return; onSelect({ page: page.index }, event.metaKey || event.shiftKey || event.ctrlKey) }}>
    {page.image ? <img src={page.image} alt="" className="block w-full" /> : <div className="aspect-[16/9] bg-[#F4F1EA]" />}
    {!generating && page.elements.map(element => <button key={element.id} type="button" data-element-id={element.id} title={element.text}
      className="absolute border-2 border-transparent hover:border-[#2563EB]/70"
      style={{ left: `${element.bounds.x / canvas.width * 100}%`, top: `${element.bounds.y / canvas.height * 100}%`, width: `${element.bounds.w / canvas.width * 100}%`, height: `${element.bounds.h / canvas.height * 100}%` }}
      onClick={event => { event.stopPropagation(); onSelect({ page: page.index, elementId: element.id }, event.metaKey || event.shiftKey || event.ctrlKey) }} />)}
  </div>
}

export function PptLivePanel({ sessionId, snapshot, busy = false, fileIndex, onFileIndex, onClose }: {
  sessionId: string
  snapshot: PptLiveSnapshot | null
  busy?: boolean
  fileIndex: number
  onFileIndex: (index: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const targets = useSyncExternalStore(subscribePptSelection, () => getPptSelection(sessionId), () => [] as ReturnType<typeof getPptSelection>)
  const generating = busy || !!snapshot?.generating
  const followPage = snapshot?.current
  const [view, setView] = useState(followPage ?? 1)
  useEffect(() => { if (generating && followPage) setView(followPage) }, [generating, followPage])
  useEffect(() => { if (generating) setPptSelection(sessionId, []) }, [generating, sessionId])
  const pages = snapshot?.pages ?? []
  const current = pages.find(page => page.index === (generating ? snapshot?.current : view)) ?? pages[view - 1] ?? pages[0]
  const previous = current ? pages.find(page => page.index === current.index - 1) : undefined
  const file = snapshot?.files[fileIndex] ?? snapshot?.files[0]
  const fileName = file?.name ?? snapshot?.fileName ?? 'deck.pptx'
  const selectedKeys = new Set(targets.map(pptTargetKey))
  const choose = (target: { page: number; elementId?: string }, toggle: boolean) => {
    setView(target.page)
    setPptSelection(sessionId, applyPptSelection(getPptSelection(sessionId), target, toggle))
  }
  const pageSelected = (page: PptLivePage) => targets.some(target => target.page === page.index && !target.elementId)

  return <aside data-testid="ppt-live-panel" aria-label={t('ppt.live.pages')} className="relative flex h-full min-h-0 w-[min(640px,52vw)] shrink-0 flex-col overflow-hidden bg-foreground-2 shadow-middle" style={{ borderRadius: RADIUS_INNER, borderBottomRightRadius: RADIUS_EDGE, marginLeft: 6 }}>
    <div className="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm">
      <strong className="min-w-0 truncate">{fileName}</strong>
      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5" onClick={() => snapshot && snapshot.files.length > 1 && onFileIndex((fileIndex + 1) % snapshot.files.length)}>
        <ArrowLeftRight className="size-3.5" />{t('ppt.live.switchFile')}
      </button>
      <div className="ml-auto shrink-0"><HeaderIconButton icon={<X className="size-4" />} tooltip={t('ppt.live.close')} onClick={onClose} /></div>
    </div>
    {snapshot?.chartFallbacks && snapshot.chartFallbacks.length > 0 && <div data-testid="ppt-chart-fallback" className="mx-3 mb-2 rounded-lg bg-[#F4F1EA] px-3 py-2 text-[12px] leading-snug text-foreground">
      {snapshot.chartFallbacks.map((item, index) => <p key={`${item.skill}-${item.page ?? 'deck'}-${index}`}>{t('ppt.live.chartFallback', { where: item.page ? t('ppt.live.chartFallback.page', { page: item.page }) : '', skill: item.skill, reason: t(`ppt.live.chartFallback.${item.reason}`) })}</p>)}
    </div>}
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div data-testid="ppt-live-stage" className="relative min-h-0 w-full flex-1 overflow-hidden bg-[#e9e9eb]">
        {generating ? <div className="absolute inset-0 overflow-auto px-6 pb-6 pt-20">
          {current ? <>
          <div className="relative mx-auto w-full max-w-[580px] overflow-hidden rounded-[2px] bg-white shadow-middle">
            <div className="relative aspect-[16/9] overflow-hidden">
              {current.image && <img src={current.image} alt="" className="absolute inset-0 h-full w-full" style={{ clipPath: 'inset(0 0 38% 0)' }} />}
              <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[#F4F1EA]">
                <div className="absolute inset-x-[5%] top-[6%] h-[10%] animate-pulse rounded bg-foreground/[0.06]" />
                <div className="absolute left-[5%] top-[28%] h-[48%] w-[42%] animate-pulse rounded bg-foreground/[0.04]" />
                <div className="absolute right-[5%] top-[28%] h-[48%] w-[44%] animate-pulse rounded bg-foreground/[0.04]" />
              </div>
              <div className="absolute inset-x-0 h-[2px] bg-accent/70" style={{ top: '62%' }} />
            </div>
          </div>
          <div className="mx-auto mt-3 max-w-[580px] text-center text-[11px] tabular-nums text-foreground/45">{t('ppt.live.pageMeta', { page: current.index, ratio: snapshot?.canvas.label, width: snapshot?.canvas.width, height: snapshot?.canvas.height })}</div>
          {previous?.image && <div className="mx-auto mt-5 max-w-[580px]">
            <div className="mb-2 text-[11px] text-foreground/45">{t('ppt.live.previous')}</div>
            <div className="overflow-hidden rounded-[2px] bg-white shadow-minimal"><img src={previous.image} alt="" className="block w-full" /></div>
          </div>}
          </> : <div className="mx-auto aspect-[16/9] max-w-[580px] animate-pulse rounded-[2px] bg-white/80" />}
        </div> : <div className="absolute inset-0 overflow-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[560px]">
            {pages.map(page => <div key={page.index} className="mb-5">
              <div className="mb-1.5 text-[11px] tabular-nums text-foreground/45">{page.index}</div>
              <div className="relative">
                <SlideFrame page={page} canvas={snapshot!.canvas} selected={pageSelected(page)} generating={false} onSelect={choose} />
                {page.elements.filter(element => selectedKeys.has(pptTargetKey({ page: page.index, elementId: element.id }))).map(element => <div key={element.id} data-element-id={element.id} className="pointer-events-none absolute" style={{ left: `${element.bounds.x / snapshot!.canvas.width * 100}%`, top: `${element.bounds.y / snapshot!.canvas.height * 100}%`, width: `${element.bounds.w / snapshot!.canvas.width * 100}%`, height: `${element.bounds.h / snapshot!.canvas.height * 100}%` }}>
                  <div className="absolute -inset-[3px] rounded-[2px] border-2 border-[#2563EB] bg-[#2563EB]/[0.06]" />
                </div>)}
              </div>
            </div>)}
            {pages.length === 0 && <div className="aspect-[16/9] animate-pulse rounded-[2px] bg-white/70" />}
          </div>
        </div>}
      </div>
      {generating && <div data-testid="ppt-live-banner" className="pointer-events-none absolute inset-x-3 top-4 flex justify-center">
        <div className="flex max-w-full items-center gap-2.5 rounded-full bg-background/95 px-4 py-2.5 text-accent shadow-minimal ring-1 ring-border/50 backdrop-blur-sm">
          <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <div className="min-w-0">
            <p className="text-xs font-medium">{t('ppt.live.generatingTitle', { page: snapshot?.current ?? 1, name: snapshot?.currentTitle ?? '' })}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('ppt.live.generatingHint')}</p>
          </div>
        </div>
      </div>}
      {!generating && targets.length > 0 && <div data-testid="ppt-live-selection" className="pointer-events-none absolute inset-x-3 bottom-[118px] flex justify-center">
        <div title={t('ppt.live.selectHint')} className="inline-flex items-center gap-2 rounded-full bg-background px-5 py-2.5 text-sm font-medium text-accent shadow-middle ring-1 ring-accent/25">
          <MousePointer2 className="size-4" /><span className="tabular-nums">{t('ppt.live.selection', { count: targets.length, max: PPT_LIVE_MAX_SELECTION })}</span>
        </div>
      </div>}
      <div data-testid="ppt-live-thumbs" className="shrink-0 border-t border-border/50 bg-foreground-2 px-3 pb-3 pt-2.5">
        <div className="mb-2 flex items-center text-[11px] text-muted-foreground">
          <span>{t('ppt.live.pages')}</span>
          <span className="ml-auto tabular-nums">{generating ? t('ppt.live.completed', { completed: snapshot?.completed ?? 0, total: snapshot?.total ?? pages.length }) : t('ppt.live.total', { total: snapshot?.total ?? pages.length })}</span>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {pages.map(page => {
            const active = page.index === (current?.index ?? 0)
            const label = STATUS_KEY[page.status]
            return <button key={page.index} type="button" data-page={page.index} data-status={page.status} disabled={generating} className="w-[84px] shrink-0 text-left disabled:cursor-default" onClick={event => { if (!generating) choose({ page: page.index }, event.metaKey || event.shiftKey || event.ctrlKey) }}>
              <div className={cn('relative aspect-[16/9] overflow-hidden rounded-[4px] bg-foreground/[0.05] shadow-minimal', active && 'ring-2 ring-accent ring-offset-1 ring-offset-background')}>
                {page.image && page.status !== 'pending' && <img src={page.image} alt="" className={cn('h-full w-full object-cover', page.status === 'fixing' && 'opacity-35')} />}
                {page.status === 'fixing' && <span className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-4 animate-spin text-accent motion-reduce:animate-none" /></span>}
                {page.status === 'pending' && <span className="absolute inset-0 animate-pulse bg-foreground/[0.03]" />}
              </div>
              <div className={cn('mt-1 text-center text-[10px] tabular-nums', active ? 'font-medium text-accent' : 'text-muted-foreground')}>{page.index}{label ? ` ${t(label)}` : ''}</div>
            </button>
          })}
        </div>
      </div>
    </div>
  </aside>
}
