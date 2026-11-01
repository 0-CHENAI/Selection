import { useAtom } from 'jotai'
import { FileText, Table2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { officeComposerAtomFamily } from '@/atoms/office'
import { officeCaseCovers } from './office-covers'

type CatalogCase = { id: string; title: string; mode: string; category?: string }
const cases = (catalog as { cases?: CatalogCase[] }).cases ?? []

/** The Word / Excel case attached to the composer, if any. */
export function attachedOfficeCase(request: { mode?: string; templateId?: string } | null | undefined): CatalogCase | undefined {
  if (!request?.templateId || (request.mode !== 'word' && request.mode !== 'excel')) return undefined
  return cases.find(item => item.id === request.templateId && item.mode === request.mode)
}

/** Chip in the input box for the case picked on the Office home. Sent as the session's Office case, not as text. */
export function OfficeSelectedCase({ composerKey, disabled }: { composerKey: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const [request, setRequest] = useAtom(officeComposerAtomFamily(composerKey))
  const item = attachedOfficeCase(request)
  if (!item) return null
  const mode = item.mode === 'excel' ? 'excel' : 'word'
  const Icon = mode === 'excel' ? Table2 : FileText
  const cover = officeCaseCovers[item.id]
  return (
    <div
      data-testid="office-selected-case"
      aria-label={t('office.case.attached', { title: item.title })}
      className="group/chip relative flex h-16 max-w-[260px] shrink-0 items-center gap-2 rounded-[8px] bg-background p-1.5 pr-3 shadow-minimal"
    >
      <span className="h-[52px] w-[92px] shrink-0 overflow-hidden rounded-[6px] border border-accent/60 bg-foreground/3">
        {cover
          ? <img src={cover} alt="" className="h-full w-full object-cover" />
          : <span className="flex h-full items-center justify-center text-muted-foreground"><Icon className="size-5" aria-hidden /></span>}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Icon className="size-3 shrink-0" aria-hidden />{t('office.case.attachedBadge')}</span>
        <span title={item.title} className="block truncate text-[12px] font-medium text-foreground">{item.title}</span>
      </span>
      <button
        type="button"
        data-testid="office-remove-case"
        disabled={disabled}
        aria-label={t('office.case.remove', { title: item.title })}
        onClick={() => setRequest({ mode })}
        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-white/30 bg-black/90 text-white opacity-0 transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none [@media(hover:none)]:opacity-100"
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  )
}
