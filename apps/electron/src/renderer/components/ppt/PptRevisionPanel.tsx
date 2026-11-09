import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ChevronRight } from 'lucide-react'
import type { PptTemplate, PptTheme } from '@craft-agent/shared/protocol'

const VISIBLE = 5

function Swatches({ colors }: { colors: string[] }) {
  return <span className="inline-flex items-center">
    {colors.map((color, index) => <span key={`${color}-${index}`} className="-ml-0.5 size-3 rounded-full ring-1 ring-foreground/15 first:ml-0" style={{ background: color }} />)}
  </span>
}

function Frame({ src, wash }: { src?: string; wash?: string }) {
  return <div className="relative aspect-video overflow-hidden rounded-md bg-foreground/5">
    {src && <img alt="" src={src} className="h-full w-full object-contain" />}
    {wash && <div className="absolute inset-0 opacity-70 mix-blend-multiply" style={{ background: wash }} />}
  </div>
}

export function PptRevisionPanel({
  tab,
  onTab,
  templates,
  themes,
  currentTemplateId,
  currentThemeId,
  coverUrl,
  total,
  onApply,
  onCancel,
}: {
  tab: 'style' | 'color'
  onTab: (tab: 'style' | 'color') => void
  templates: PptTemplate[]
  themes: PptTheme[]
  currentTemplateId?: string
  currentThemeId?: string
  coverUrl?: string
  total: number
  onApply: (id: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const items = tab === 'style' ? templates : themes
  const currentId = tab === 'style' ? currentTemplateId : currentThemeId
  const [selectedId, setSelectedId] = useState(currentId)
  const [more, setMore] = useState(() => items.findIndex(item => item.id === currentId) >= VISIBLE)
  const selected = items.find(item => item.id === selectedId)
  const theme = tab === 'color' ? themes.find(item => item.id === selectedId) : undefined
  const template = tab === 'style' ? templates.find(item => item.id === selectedId) : undefined
  const afterSrc = tab === 'style' ? template?.cover : coverUrl
  const hidden = Math.max(0, items.length - VISIBLE)
  const visibleItems = more ? items : items.slice(0, VISIBLE)
  const selectedName = selected && 'title' in selected ? selected.title : selected?.name
  return <div data-testid="ppt-revision-panel" className="flex flex-col gap-3">
    <div role="tablist" className="flex gap-3 text-sm">
      <button type="button" role="tab" aria-selected={tab === 'style'} data-testid="ppt-revision-tab-style" className={tab === 'style' ? 'font-medium text-foreground' : 'text-muted-foreground'} onClick={() => onTab('style')}>{t('ppt.result.style')}</button>
      <button type="button" role="tab" aria-selected={tab === 'color'} data-testid="ppt-revision-tab-color" className={tab === 'color' ? 'font-medium text-foreground' : 'text-muted-foreground'} onClick={() => onTab('color')}>{t('ppt.result.color')}</button>
    </div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <figure className="min-w-0">
        <Frame src={coverUrl} />
        <figcaption className="mt-1 truncate text-[11px] text-muted-foreground">{t('ppt.result.now')}</figcaption>
      </figure>
      <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
      <figure className="min-w-0">
        <div className="relative">
          <Frame src={afterSrc} wash={theme?.paper} />
          {theme && <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: theme.accent }} />}
        </div>
        <figcaption className="mt-1 truncate text-[11px] text-muted-foreground">{selectedName ? t('ppt.result.previewLabel', { name: selectedName }) : t('ppt.result.previewLabel', { name: t('ppt.result.current') })}</figcaption>
      </figure>
    </div>
    <div className="flex max-h-64 flex-col overflow-auto">
      {visibleItems.map(item => {
        const name = 'title' in item ? item.title : item.name
        const active = item.id === selectedId
        const colors = 'paper' in item ? [item.paper, item.ink, item.accent, item.signal] : []
        return <button key={item.id} type="button" data-testid="ppt-revision-option" aria-pressed={active} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-foreground/5" onClick={() => setSelectedId(item.id)}>
          {tab === 'style' && 'cover' in item && item.cover
            ? <img alt="" src={item.cover} className="h-6 w-10 shrink-0 rounded-sm object-contain" />
            : <Swatches colors={colors} />}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {item.id === currentId && <span className="shrink-0 text-[11px] text-muted-foreground">{t('ppt.result.current')}</span>}
          {active && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
        </button>
      })}
    </div>
    {hidden > 0 && <button type="button" className="inline-flex items-center gap-1 text-left text-[13px] text-muted-foreground hover:text-foreground" aria-expanded={more} onClick={() => setMore(open => !open)}>
      <ChevronRight aria-hidden="true" className={`size-3.5 transition-transform motion-reduce:transition-none ${more ? 'rotate-90' : ''}`} />
      {t(tab === 'color' ? 'ppt.result.moreColors' : 'ppt.result.moreStyles', { count: hidden })}
    </button>}
    <div className="flex items-center justify-end gap-2">
      <button type="button" className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/5" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" data-testid="ppt-revision-apply" disabled={!selectedId || selectedId === currentId} className="rounded-md bg-foreground px-3 py-1.5 text-[13px] text-background disabled:opacity-40" onClick={() => { if (selectedId && selectedId !== currentId) onApply(selectedId) }}>{t('ppt.result.applyAll', { count: total })}</button>
    </div>
  </div>
}
