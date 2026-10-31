import { useAtom } from 'jotai'
import * as React from 'react'
import { Eye, FileText, Sparkles, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { officeComposerAtomFamily } from '@/atoms/office'
import type { InsertTextEventDetail } from '@/components/app-shell/input/input-event-guards'
import { cn } from '@/lib/utils'
import { closeOfficeCasePreview, requestOfficeCasePreview } from '@/lib/office-preview-page'
import { officeCaseCovers } from './office-covers'
import { casesForOfficeHome, sameStyleDraft } from './office-home'

type OfficeCase = {
  id: string
  title: string
  mode: 'word' | 'excel'
  revision: string
  description?: string
  category?: string
  prompt?: string
  sampleFile?: string | null
  businessSkill?: string
  businessSkills?: string[]
}

const cases = (catalog as { cases?: OfficeCase[] }).cases ?? []

const caseActionClass = cn(
  'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[7px] border border-border/60 bg-background/95 px-2 text-[12px] text-foreground shadow-minimal',
  'transition-colors hover:bg-foreground/5 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
)

/** Only Word / Excel samples the host can copy. Cases without a file have nothing to preview. */
export function hasOfficeCaseSample(item: { sampleFile?: string | null }): boolean {
  return typeof item.sampleFile === 'string' && /\.(docx|xlsx)$/i.test(item.sampleFile)
}

/** Select the case and put its catalog prompt in the composer with the first 【…】 selected. Never sends. */
export function fillSameStylePrompt(item: Pick<OfficeCase, 'prompt'>, sessionId: string | undefined) {
  const detail: InsertTextEventDetail = { sessionId, compose: current => sameStyleDraft(item.prompt, current) }
  window.dispatchEvent(new CustomEvent<InsertTextEventDetail>('craft:insert-text', { detail }))
}

export function OfficeCaseGallery({ mode, composerKey, sessionId }: { mode: 'word' | 'excel'; composerKey: string; sessionId?: string }) {
  const { t } = useTranslation()
  const [request, setRequest] = useAtom(officeComposerAtomFamily(composerKey))
  const items = casesForOfficeHome(cases, mode)
  const Icon = mode === 'word' ? FileText : Table2
  // A sample opened from the home closes with the home.
  React.useEffect(() => () => closeOfficeCasePreview(), [])
  return (
    <div className="mx-auto mt-7 w-full max-w-[1000px] min-h-0 overflow-y-auto px-8 pb-8" data-testid={`office-case-gallery-${mode}`}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
        {items.map(item => {
          const selected = request?.mode === mode && request.templateId === item.id
          return (
            <article key={item.id} className="group/case relative min-w-0 @container/case">
              <button
                type="button"
                data-testid={`office-case-${item.id}`}
                aria-pressed={selected}
                aria-label={item.title}
                onClick={() => setRequest(selected ? { mode } : { mode, templateId: item.id, revision: item.revision })}
                className={cn(
                  'block aspect-video w-full overflow-hidden rounded-[8px] border border-border/50 bg-foreground/3 text-left shadow-minimal',
                  'transition-transform hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none',
                  selected && 'ring-2 ring-accent ring-offset-2 ring-offset-background',
                )}
              >
                {officeCaseCovers[item.id]
                  ? <img src={officeCaseCovers[item.id]} alt="" className="h-full w-full object-cover" />
                  : <span className="flex h-full items-center justify-center text-muted-foreground"><Icon className="size-6" aria-hidden /></span>}
              </button>
              <div className={cn(
                'absolute right-2 top-2 flex items-center gap-1',
                'opacity-0 transition-opacity group-hover/case:opacity-100 group-focus-within/case:opacity-100',
                'motion-reduce:transition-none [@media(hover:none)]:opacity-100',
              )}>
                {hasOfficeCaseSample(item) && (
                  <button
                    type="button"
                    data-testid={`office-case-preview-${item.id}`}
                    aria-label={t('office.case.previewLabel', { title: item.title })}
                    title={t('office.case.previewHint')}
                    onClick={() => requestOfficeCasePreview({ caseId: item.id })}
                    className={caseActionClass}
                  >
                    <Eye className="size-3.5 shrink-0" aria-hidden />
                    <span className="hidden @[220px]/case:inline">{t('office.case.preview')}</span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`office-case-same-${item.id}`}
                  aria-label={t('office.case.useThisLabel', { title: item.title })}
                  onClick={() => {
                    setRequest({ mode, templateId: item.id, revision: item.revision })
                    fillSameStylePrompt(item, sessionId)
                  }}
                  className={caseActionClass}
                >
                  <Sparkles className="size-3.5 shrink-0" aria-hidden />
                  <span className="hidden @[220px]/case:inline">{t('office.case.useThis')}</span>
                </button>
              </div>
              <p title={item.title} className="mt-2 truncate text-[13px]">{item.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.category}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}
