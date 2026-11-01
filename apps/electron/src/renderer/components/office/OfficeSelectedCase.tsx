import { useAtom } from 'jotai'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { officeComposerAtomFamily } from '@/atoms/office'
import { requestOfficeCasePreview } from '@/lib/office-preview-page'
import { AttachedCoverCard } from '@/components/ppt/SelectedTemplate'
import { officeCaseCovers } from './office-covers'

type CatalogCase = { id: string; title: string; mode: string; category?: string; sampleFile?: string | null }
const cases = (catalog as { cases?: CatalogCase[] }).cases ?? []

/** The Word / Excel case attached to the composer, if any. */
export function attachedOfficeCase(request: { mode?: string; templateId?: string } | null | undefined): CatalogCase | undefined {
  if (!request?.templateId || (request.mode !== 'word' && request.mode !== 'excel')) return undefined
  return cases.find(item => item.id === request.templateId && item.mode === request.mode)
}

/** ⋯ on the attached case: open its sample read-only in the Office panel, then close the menu. */
export function previewAttachedOfficeCase(caseId: string, close: () => void) {
  requestOfficeCasePreview({ caseId })
  close()
}

/**
 * The case picked on the Office home, shown in the input box exactly like the attached PPT template:
 * tilted cover over fanned pages, × removes it, ⋯ opens a menu whose action is 预览.
 * Sent as the session's Office case, not as text.
 */
export function OfficeSelectedCase({ composerKey, disabled }: { composerKey: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const [request, setRequest] = useAtom(officeComposerAtomFamily(composerKey))
  const item = attachedOfficeCase(request)
  if (!item) return null
  const mode = item.mode === 'excel' ? 'excel' : 'word'
  const canPreview = typeof item.sampleFile === 'string' && /\.(docx|xlsx)$/i.test(item.sampleFile)
  return (
    <AttachedCoverCard
      id={item.id}
      cover={officeCaseCovers[item.id] ?? ''}
      title={item.title}
      label={t('office.case.attached', { title: item.title })}
      flightKey={composerKey}
      disabled={disabled}
      onRemove={() => setRequest({ mode })}
      removeLabel={t('office.case.remove', { title: item.title })}
      menuLabel={t('office.case.options', { title: item.title })}
      menuClassName="w-[240px] p-1.5"
      testIds={{ root: 'office-selected-case', remove: 'office-remove-case', menu: 'office-case-options', panel: 'office-case-options-panel' }}
      menu={close => (
        <div className="flex flex-col gap-1">
          <div className="px-2 pb-1 pt-1.5">
            <p title={item.title} className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t('office.case.attachedBadge')}{item.category ? ` · ${item.category}` : ''}</p>
          </div>
          {canPreview && (
            <button
              type="button"
              data-testid="office-case-options-preview"
              onClick={() => previewAttachedOfficeCase(item.id, close)}
              className="flex h-8 items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            >
              <Eye className="size-3.5 shrink-0" aria-hidden />
              {t('office.case.previewSample')}
            </button>
          )}
        </div>
      )}
    />
  )
}
