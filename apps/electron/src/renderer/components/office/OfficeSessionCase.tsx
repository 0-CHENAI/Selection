import { Eye, FileText, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { requestOfficeCasePreview } from '@/lib/office-preview-page'
import { hasOfficeCaseSample } from './OfficeCaseGallery'

type CatalogCase = { id: string; title: string; mode: string; sampleFile?: string | null }
const cases = (catalog as { cases?: CatalogCase[] }).cases ?? []

/** The Word / Excel case a chat was started from, with a read-only preview of its sample. */
export function officeSessionCase(office: { mode?: string; templateId?: string } | null | undefined): CatalogCase | undefined {
  if (!office?.templateId || (office.mode !== 'word' && office.mode !== 'excel')) return undefined
  const item = cases.find(entry => entry.id === office.templateId && entry.mode === office.mode)
  return item && hasOfficeCaseSample(item) ? item : undefined
}

export function OfficeSessionCase({ sessionId, office }: { sessionId: string; office: { mode?: string; templateId?: string } | null | undefined }) {
  const { t } = useTranslation()
  const item = officeSessionCase(office)
  if (!item) return null
  const Icon = item.mode === 'excel' ? Table2 : FileText
  return (
    <div className="mb-2 flex min-w-0 items-center gap-1.5" data-testid="office-session-case">
      <span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[8px] bg-accent/10 px-2 text-[12px] font-medium text-accent">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{item.title}</span>
      </span>
      <button
        type="button"
        data-testid={`office-session-case-preview-${item.id}`}
        aria-label={t('office.case.previewLabel', { title: item.title })}
        title={t('office.case.previewHint')}
        onClick={() => requestOfficeCasePreview({ caseId: item.id, sessionId })}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
      >
        <Eye className="size-3.5" aria-hidden />
        {t('office.case.preview')}
      </button>
    </div>
  )
}
