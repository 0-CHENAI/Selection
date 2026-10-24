import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, ImagePlus, Palette, RectangleHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import type { PptRequest, PptTheme } from '@craft-agent/shared/protocol'

export function TemplateOptions({ request, themes, onChange }: {
  request: PptRequest | undefined
  themes: PptTheme[]
  onChange: (value: Partial<PptRequest>) => void
}) {
  const { t } = useTranslation()
  const [brandOpen, setBrandOpen] = React.useState(false)
  const logoInput = React.useRef<HTMLInputElement>(null)
  return <>
    <p className="px-2 pb-2 pt-1.5 text-xs text-muted-foreground">{t('ppt.optionalSettings')}</p>
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 text-sm"><Palette className="size-3.5 text-muted-foreground" /><span className="flex-1">{t('ppt.theme')}</span><span className="text-xs text-muted-foreground">{themes.find(theme => theme.id === request?.themeId)?.name ?? t('ppt.templateAspect')}</span></div>
      <div className="mt-2.5 grid grid-cols-7 gap-1.5 pl-[22px]">
        <button type="button" aria-label={t('ppt.followTemplateTheme')} title={t('ppt.followTemplateTheme')} aria-pressed={!request?.themeId} onClick={() => onChange({ themeId: undefined })} className={`grid size-7 place-items-center rounded-full ${!request?.themeId ? 'ring-2 ring-accent ring-offset-1 ring-offset-background' : 'ring-1 ring-border'}`} style={{ background: 'conic-gradient(#123b57 0 50%,#f4f1ea 0)' }}>{!request?.themeId && <Check className="size-3 text-white mix-blend-difference" />}</button>
        {themes.map(theme => <button key={theme.id} type="button" title={theme.name} aria-label={theme.name} aria-pressed={request?.themeId === theme.id} onClick={() => onChange({ themeId: theme.id })} className={`relative size-7 overflow-hidden rounded-full shadow-minimal ${request?.themeId === theme.id ? 'ring-2 ring-accent ring-offset-1 ring-offset-background' : 'ring-1 ring-black/5'}`} style={{ background: theme.paper }}><span className="absolute inset-y-0 right-0 w-1/2" style={{ background: theme.accent }} />{request?.themeId === theme.id && <Check className="relative mx-auto size-3 text-white mix-blend-difference" />}</button>)}
      </div>
    </div>
    <div className="my-1 border-t border-border/70" />
    <button type="button" onClick={() => setBrandOpen(open => !open)} aria-expanded={brandOpen} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-foreground/5"><ImagePlus className="size-3.5 text-muted-foreground" /><span className="flex-1">{t('ppt.brandOptions')}</span><span className="text-xs text-muted-foreground">{t(request?.brandColor || request?.logo ? 'ppt.configured' : 'ppt.notConfigured')}</span><ChevronRight className={`size-3.5 transition-transform motion-reduce:transition-none ${brandOpen ? 'rotate-90' : ''}`} /></button>
    {brandOpen && <div className="space-y-3 rounded-lg bg-foreground/3 p-3">
      <label className="flex items-center justify-between text-xs">{t('ppt.brandColor')}<input type="color" aria-label={t('ppt.brandColor')} value={request?.brandColor ?? '#8b5527'} onChange={event => onChange({ brandColor: event.target.value })} className="h-7 w-12 rounded border border-border" /></label>
      {request?.brandColor && <button type="button" onClick={() => onChange({ brandColor: undefined })} className="text-xs text-muted-foreground hover:text-foreground">{t('ppt.resetBrandColor')}</button>}
      <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={t('ppt.chooseLogo')} className="hidden" onChange={event => {
        const file = event.target.files?.[0]
        if (!file) return
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 3 * 1024 * 1024) { toast.error(t('ppt.logoError')); return }
        const reader = new FileReader()
        reader.onload = () => { if (typeof reader.result === 'string') onChange({ logo: { name: file.name, mimeType: file.type, base64: reader.result.slice(reader.result.indexOf(',') + 1) } }) }
        reader.onerror = () => toast.error(t('ppt.logoError'))
        reader.readAsDataURL(file)
        event.target.value = ''
      }} />
      <button type="button" onClick={() => logoInput.current?.click()} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs"><ImagePlus className="size-3.5" />{t('ppt.chooseLogo')}</button>
      {request?.logo && <div className="flex items-center gap-2"><img className="size-7 object-contain" alt="" src={`data:${request.logo.mimeType};base64,${request.logo.base64}`} /><span className="min-w-0 flex-1 truncate text-xs">{request.logo.name}</span><button type="button" aria-label={t('ppt.removeLogo')} onClick={() => onChange({ logo: undefined })}><X className="size-3" /></button></div>}
    </div>}
    <div className="my-1 border-t border-border/70" />
    <div className="px-2 py-2"><div className="flex items-center gap-2 text-sm"><RectangleHorizontal className="size-3.5 text-muted-foreground" />{t('ppt.aspect')}</div><div className="ml-[22px] mt-2 flex flex-wrap gap-0.5 rounded-lg border border-border/60 bg-foreground/2 p-0.5">{(['template', '16:9', '4:3', '1:1', '9:16', '3:4', 'A4'] as const).map(value => <button key={value} type="button" aria-pressed={(request?.aspectRatio ?? 'template') === value} onClick={() => onChange({ aspectRatio: value })} className={`h-6 rounded-md px-1.5 text-xs tabular-nums ${(request?.aspectRatio ?? 'template') === value ? 'bg-background font-medium shadow-minimal' : 'text-muted-foreground hover:bg-background/70'}`}>{value === 'template' ? t('ppt.templateAspect') : value}</button>)}</div></div>
  </>
}
