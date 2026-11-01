import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { requestOfficeCasePreview } from '@/lib/office-preview-page'
import { officeCaseCovers } from './office-covers'

type CatalogCase = { id: string; title: string; mode: string; category?: string; sampleFile?: string | null }
const cases = (catalog as { cases?: CatalogCase[] }).cases ?? []

/** The Word / Excel case a sent message was started from (stored in `turnContext.office`). */
export function sentOfficeCase(office: unknown): CatalogCase | undefined {
  if (!office || typeof office !== 'object') return undefined
  const { mode, templateId } = office as { mode?: unknown; templateId?: unknown }
  if ((mode !== 'word' && mode !== 'excel') || typeof templateId !== 'string') return undefined
  return cases.find(item => item.id === templateId && item.mode === mode)
}

/** Click on a sent case card: open its sample read-only in this chat's Office panel. */
export function openSentOfficeCase(caseId: string, sessionId: string | undefined) {
  requestOfficeCasePreview({ caseId, sessionId })
}

/**
 * Same card as the PPT reference template on a sent message: the case cover, title on hover.
 * As in dsh, clicking it opens the case sample read-only in the Office panel.
 */
export function SentOfficeCase({ office, sessionId }: { office: unknown; sessionId?: string }) {
  const { t } = useTranslation()
  const item = sentOfficeCase(office)
  if (!item) return null
  const label = t('office.case.referenceCase', { title: item.title })
  const cover = officeCaseCovers[item.id]
  const canPreview = typeof item.sampleFile === 'string' && /\.(docx|xlsx)$/i.test(item.sampleFile)
  const className = 'block h-14 w-[98px] shrink-0 overflow-hidden rounded-[8px] border border-border/50 bg-background p-0 shadow-minimal'
  const image = cover
    ? <img src={cover} alt={label} className="h-full w-full object-cover" />
    : <span className="flex h-full items-center justify-center px-1 text-center text-[11px] text-muted-foreground">{item.title}</span>
  if (!canPreview) return <div title={label} className={className} data-testid="office-sent-case" data-office-case={item.id}>{image}</div>
  return (
    <button
      type="button"
      title={`${label} · ${t('office.case.previewHint')}`}
      aria-label={t('office.case.previewLabel', { title: item.title })}
      data-testid="office-sent-case"
      data-office-case={item.id}
      onClick={() => openSentOfficeCase(item.id, sessionId)}
      className={`${className} cursor-pointer transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transform-none motion-reduce:transition-none`}
    >
      {image}
    </button>
  )
}
