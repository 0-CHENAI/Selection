import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Eye, Search, Upload, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import type { PptCategory, PptTemplate } from '@craft-agent/shared/protocol'
import { usePptCatalog, usePptTemplatePages } from './usePptCatalog'

const categories: [PptCategory, string][] = [['商务', 'business'], ['咨询', 'consulting'], ['学术', 'academic'], ['教学', 'teaching'], ['技术', 'technology'], ['创意', 'creative'], ['社媒', 'social']]
export function TemplateGallery({ onSelect, compact = false, selectedId }: { onSelect: (template: PptTemplate, source: DOMRect) => void; compact?: boolean; selectedId?: string }) {
  const { t } = useTranslation()
  const { catalog, error, retry } = usePptCatalog()
  const [category, setCategory] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [preview, setPreview] = React.useState<PptTemplate>()
  const previewPages = usePptTemplatePages(preview?.id)
  const templates = catalog?.templates.filter(template => (category === 'all' || category === template.category) && template.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []
  return <section data-testid="ppt-template-gallery" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {[['all', t('ppt.all')], ...categories.map(([value, key]) => [value, t(`ppt.categories.${key}`)]), ['custom', t('ppt.custom')]].map(([value, label]) => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value!)} className={`inline-flex shrink-0 items-center gap-1 rounded-md whitespace-nowrap transition-colors ${compact ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]'} ${category === value ? 'bg-foreground/7 font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/5'}`}>{value === 'custom' && <Upload className="size-3" />}{label}{!compact && catalog && categories.some(([key]) => key === value) && <span className="text-[11px] tabular-nums text-foreground/35">{catalog.templates.filter(template => template.category === value).length}</span>}</button>)}
      <label className={`ml-auto flex items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1 shadow-minimal ${compact ? 'w-32' : 'w-44'}`}><Search className="size-3.5 text-muted-foreground" /><input aria-label={t('ppt.searchTemplates')} placeholder={t('ppt.searchTemplates')} value={search} onChange={event => setSearch(event.target.value)} className="w-full bg-transparent text-xs outline-none" /></label>
    </div>
    {category === 'custom' ? <div data-testid="ppt-custom-placeholder" className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><Upload className="mx-auto mb-3 size-6 text-muted-foreground" /><h3 className="text-sm font-medium">{t('ppt.customTitle')}</h3><p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">{t('ppt.customDescription')}</p></div> : error ? <div className="py-8 text-center text-sm">{t('ppt.loadError')} <button type="button" onClick={retry} className="underline">{t('ppt.retry')}</button></div> : !catalog ? <p className="py-8 text-center text-sm text-muted-foreground">{t('ppt.loading')}</p> : <>
      {!templates.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('ppt.noTemplates')}</p>}
      <div className={`grid gap-x-4 gap-y-5 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 @xl/panel:grid-cols-4 sm:grid-cols-3 xl:grid-cols-4'}`}>
        {templates.map(template => {
          const selected = template.id === selectedId
          return <article key={template.id} data-testid={`ppt-template-${template.id}`} className="group min-w-0">
          <div className="relative">
            <button type="button" data-testid="ppt-template-select" aria-label={template.title} aria-pressed={selected} onClick={event => onSelect(template, event.currentTarget.getBoundingClientRect())} className={`block aspect-video w-full overflow-hidden rounded-[8px] border border-border/50 bg-foreground/3 shadow-minimal transition-transform hover:-translate-y-0.5 motion-reduce:transform-none ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}><img src={template.cover} alt={template.title} loading={compact ? 'eager' : 'lazy'} className={`h-full w-full ${template.canvas === '16:9' ? 'object-cover' : 'object-contain'}`} /></button>
            {selected ? <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow-minimal"><Check className="size-3" strokeWidth={3} /></span> : <button type="button" onClick={() => setPreview(template)} className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-background/95 px-2 py-1 text-[10px] shadow-minimal opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={`${t('ppt.preview')} ${template.title}`}><Eye className="size-3" />{t('ppt.preview')}</button>}
            {template.canvas !== '16:9' && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1 text-[10px] text-white">{template.canvas}</span>}
          </div>
          <p title={template.title} className="mt-2 truncate text-[13px]">{template.title}</p>
          {!compact && <p className="mt-0.5 text-[11px] text-muted-foreground">{t(`ppt.categories.${categories.find(([key]) => key === template.category)?.[1] ?? 'business'}`)} · {t('ppt.pages', { count: template.pages })}</p>}
        </article>})}
      </div>
    </>}
    <Dialog.Root open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined) }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-modal bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-modal flex max-h-[90vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background p-5 shadow-modal-small" data-testid="ppt-page-preview">
        <div className="mb-4 flex items-center justify-between gap-3"><Dialog.Title className="truncate text-base font-semibold">{preview?.title}</Dialog.Title><Dialog.Close aria-label={t('ppt.close')}><X className="size-4" /></Dialog.Close></div>
        <Dialog.Description className="mb-3 text-xs text-muted-foreground">{t('ppt.preview')} · {t('ppt.pages', { count: previewPages.pages?.length ?? preview?.pages ?? 0 })}</Dialog.Description>
        <div className="min-h-0 space-y-4 overflow-y-auto">{previewPages.error ? <p role="alert" className="py-8 text-center text-sm">{t('ppt.loadError')} <button type="button" onClick={previewPages.retry} className="underline">{t('ppt.retry')}</button></p> : !previewPages.pages ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t('ppt.loading')}</p> : previewPages.pages.map((page, index, pages) => <figure key={`${preview?.id}-${index}`}><img src={page} alt={`${preview?.title} — ${index + 1}`} className="max-h-[70vh] w-full rounded border border-border/50 object-contain" /><figcaption className="mt-1 text-center text-xs text-muted-foreground">{index + 1} / {pages.length}</figcaption></figure>)}</div>
        <button type="button" className="mt-4 self-end rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground" onClick={event => { if (preview) { onSelect(preview, event.currentTarget.getBoundingClientRect()); setPreview(undefined) } }}>{t('ppt.selectTemplate')}</button>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>
}
