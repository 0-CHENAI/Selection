import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Download, Eye, Pencil, Search, Trash2, Upload, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import type { PptCategory, PptTemplate } from '@craft-agent/shared/protocol'
import { refreshPptCatalog, usePptCatalog } from './usePptCatalog'
import { PptTemplatePreview } from './PptTemplatePreview'

const categories: [PptCategory, string][] = [['商务', 'business'], ['咨询', 'consulting'], ['学术', 'academic'], ['教学', 'teaching'], ['技术', 'technology'], ['创意', 'creative'], ['社媒', 'social']]

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return btoa(binary)
}

function CustomTemplateActions({ template, onChanged }: { template: PptTemplate; onChanged: () => void }) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = React.useState(false)
  const [title, setTitle] = React.useState(template.title)
  const [confirming, setConfirming] = React.useState(false)
  const save = async () => {
    const next = title.trim()
    if (!next || next === template.title) { setRenaming(false); setTitle(template.title); return }
    await window.electronAPI.renamePptTemplate(template.id, next)
    setRenaming(false)
    onChanged()
  }
  const remove = async () => {
    if (!confirming) { setConfirming(true); return }
    await window.electronAPI.deletePptTemplate(template.id)
    onChanged()
  }
  const download = async () => {
    const file = await window.electronAPI.exportPptTemplate(template.id)
    const binary = atob(file.base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    const url = URL.createObjectURL(new Blob([bytes], { type: file.name.toLowerCase().endsWith('.json') ? 'application/json' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  }
  return <div className="mt-1 flex items-center gap-1">
    {renaming ? <input data-testid="ppt-custom-rename-input" aria-label={t('ppt.customRename')} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') { setRenaming(false); setTitle(template.title) } }} onBlur={() => void save()} className="w-full rounded bg-muted/50 px-1.5 py-0.5 text-[12px] outline-none" autoFocus /> : <>
      <button type="button" aria-label={t('ppt.customRename')} className="rounded p-1 text-muted-foreground hover:bg-foreground/5" onClick={() => { setTitle(template.title); setRenaming(true) }}><Pencil className="size-3" /></button>
      <button type="button" aria-label={t('ppt.customExport')} className="rounded p-1 text-muted-foreground hover:bg-foreground/5" onClick={() => void download()}><Download className="size-3" /></button>
      <button type="button" data-testid="ppt-custom-delete" aria-label={t('ppt.customDelete')} aria-pressed={confirming} className="rounded p-1 text-muted-foreground hover:bg-foreground/5" onClick={() => void remove()}><Trash2 className="size-3" /></button>
      {confirming && <button type="button" className="text-[11px] text-muted-foreground" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>}
    </>}
  </div>
}

/** Cards show only cover, title, and category · pages. Color variants are picked in TemplateOptions after the parent card is chosen. */
export function TemplateGrid({ templates, compact, selectedId, onSelect, onPreview, onChanged }: { templates: PptTemplate[]; compact: boolean; selectedId?: string; onSelect: (template: PptTemplate, source: DOMRect) => void; onPreview: (template: PptTemplate) => void; onChanged?: () => void }) {
  const { t } = useTranslation()
  return <div className={`grid gap-x-4 gap-y-5 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 @xl/panel:grid-cols-4 sm:grid-cols-3 xl:grid-cols-4'}`}>
    {templates.map(template => {
      const selected = template.id === selectedId || !!template.variants?.some(variant => variant.id === selectedId)
      return <article key={template.id} data-testid={`ppt-template-${template.id}`} className="group min-w-0">
        <div className="relative">
          <button type="button" data-testid="ppt-template-select" aria-label={template.title} aria-pressed={selected} onClick={event => onSelect(template, event.currentTarget.getBoundingClientRect())} className={`block aspect-video w-full overflow-hidden rounded-[8px] border border-border/50 bg-foreground/3 shadow-minimal transition-transform hover:-translate-y-0.5 motion-reduce:transform-none ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}><img src={template.cover} alt={template.title} loading={compact ? 'eager' : 'lazy'} className={`h-full w-full ${template.canvas === '16:9' ? 'object-cover' : 'object-contain'}`} /></button>
          {selected ? <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow-minimal"><Check className="size-3" strokeWidth={3} /></span> : <button type="button" onClick={() => onPreview(template)} className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-background/95 px-2 py-1 text-[10px] shadow-minimal opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={`${t('ppt.preview')} ${template.title}`}><Eye className="size-3" />{t('ppt.preview')}</button>}
          {template.canvas !== '16:9' && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1 text-[10px] text-white">{template.canvas}</span>}
        </div>
        <p title={template.title} className="mt-2 truncate text-[13px]">{template.title}</p>
        {!compact && <p className="mt-0.5 text-[11px] text-muted-foreground">{template.category === '自定义' ? t('ppt.custom') : t(`ppt.categories.${categories.find(([key]) => key === template.category)?.[1] ?? 'business'}`)} · {t('ppt.pages', { count: template.pages })}</p>}
        {template.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{template.note}</p>}
        {template.category === '自定义' && onChanged && <CustomTemplateActions template={template} onChanged={onChanged} />}
      </article>
    })}
  </div>
}

export function TemplateGallery({ onSelect, compact = false, selectedId }: { onSelect: (template: PptTemplate, source: DOMRect) => void; compact?: boolean; selectedId?: string }) {
  const { t } = useTranslation()
  const [revision, setRevision] = React.useState(0)
  const { catalog, error, retry } = usePptCatalog(revision)
  const [category, setCategory] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [preview, setPreview] = React.useState<PptTemplate>()
  const [notice, setNotice] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const refresh = () => { refreshPptCatalog(); setRevision(value => value + 1) }
  const query = search.trim().toLocaleLowerCase()
  const matches = (template: PptTemplate) => {
    const inCategory = category === 'all' || (category === 'custom' ? template.category === '自定义' : template.category === category)
    const variantHit = template.variants?.some(variant => variant.title.toLocaleLowerCase().includes(query))
    return inCategory && (template.title.toLocaleLowerCase().includes(query) || !!variantHit)
  }
  const templates = catalog?.templates.filter(matches) ?? []
  const primary = templates.filter(template => template.tier !== 'more')
  const more = templates.filter(template => template.tier === 'more')
  const upload = async (file: File) => {
    setImporting(true)
    setNotice('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await window.electronAPI.importPptTemplate({ name: file.name, base64: bytesToBase64(bytes) })
      setNotice(result.duplicate ? t('ppt.customExists') : t('ppt.customImported'))
      refresh()
    } catch {
      setNotice(t('ppt.customFailed'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return <section data-testid="ppt-template-gallery" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {[['all', t('ppt.all')], ...categories.map(([value, key]) => [value, t(`ppt.categories.${key}`)]), ['custom', t('ppt.custom')]].map(([value, label]) => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value!)} className={`inline-flex shrink-0 items-center gap-1 rounded-md whitespace-nowrap transition-colors ${compact ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]'} ${category === value ? 'bg-foreground/7 font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/5'}`}>{value === 'custom' && <Upload className="size-3" />}{label}{!compact && catalog && (categories.some(([key]) => key === value) || value === 'custom') && <span className="text-[11px] tabular-nums text-foreground/35">{catalog.templates.filter(template => value === 'custom' ? template.category === '自定义' : template.category === value).length}</span>}</button>)}
      <label className={`ml-auto flex items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1 shadow-minimal ${compact ? 'w-32' : 'w-44'}`}><Search className="size-3.5 text-muted-foreground" /><input aria-label={t('ppt.searchTemplates')} placeholder={t('ppt.searchTemplates')} value={search} onChange={event => setSearch(event.target.value)} className="w-full bg-transparent text-xs outline-none" /></label>
    </div>
    {category === 'custom' && <div data-testid="ppt-custom-library" className="mb-4 rounded-xl border border-dashed border-border px-4 py-4">
      <div className="flex items-center gap-3">
        <Upload className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t('ppt.customTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('ppt.customDescription')}</p>
        </div>
        <button type="button" data-testid="ppt-custom-upload" disabled={importing} className="shrink-0 rounded-lg bg-foreground/5 px-3 py-1.5 text-xs disabled:opacity-50" onClick={() => fileRef.current?.click()}>{t('ppt.customUpload')}</button>
        <input ref={fileRef} data-testid="ppt-custom-file" type="file" accept=".pptx,.json,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/json" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      </div>
      {notice && <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p>}
    </div>}
    {error ? <div className="py-8 text-center text-sm">{t('ppt.loadError')} <button type="button" onClick={retry} className="underline">{t('ppt.retry')}</button></div> : !catalog ? <p className="py-8 text-center text-sm text-muted-foreground">{t('ppt.loading')}</p> : <>
      {!templates.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('ppt.noTemplates')}</p>}
      {!!primary.length && <TemplateGrid templates={primary} compact={compact} selectedId={selectedId} onSelect={onSelect} onPreview={setPreview} onChanged={refresh} />}
      {!!more.length && <details data-testid="ppt-more-templates" className="mt-6" open={query ? true : undefined}>
        <summary className="cursor-pointer text-[13px] text-muted-foreground">{t('ppt.moreTemplates')} · {more.length}</summary>
        <div className="mt-4"><TemplateGrid templates={more} compact={compact} selectedId={selectedId} onSelect={onSelect} onPreview={setPreview} onChanged={refresh} /></div>
      </details>}
    </>}
    <Dialog.Root open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined) }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-modal bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-modal flex max-h-[90vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background p-5 shadow-modal-small" data-testid="ppt-page-preview">
        <div className="mb-4 flex items-center justify-between gap-3"><Dialog.Title className="truncate text-base font-semibold">{preview?.title}</Dialog.Title><Dialog.Close aria-label={t('ppt.close')}><X className="size-4" /></Dialog.Close></div>
        <Dialog.Description className="mb-3 text-xs text-muted-foreground">{t('ppt.preview')} · {t('ppt.pages', { count: preview?.pages ?? 0 })}</Dialog.Description>
        <div data-ppt-preview-scroll className="min-h-0 space-y-4 overflow-y-auto">{preview && <PptTemplatePreview key={preview.id} template={preview} />}</div>
        <button type="button" className="mt-4 self-end rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground" onClick={event => { if (preview) { onSelect(preview, event.currentTarget.getBoundingClientRect()); setPreview(undefined) } }}>{t('ppt.selectTemplate')}</button>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>
}
