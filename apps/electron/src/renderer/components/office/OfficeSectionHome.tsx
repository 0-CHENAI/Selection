import { useTranslation } from 'react-i18next'
import catalog from '../../../../resources/skills/office-business/catalog.json'

type OfficeTemplate = {
  id: string
  title: string
  mode: 'word' | 'excel'
  revision: string
  description?: string
  businessSkill?: string
  businessSkills?: string[]
}

const templates = (catalog as { cases?: OfficeTemplate[] }).cases ?? []

/** Word / Excel landing list. PPT keeps its existing gallery. Case files arrive later. */
export function OfficeSectionHome({ section }: { section: 'word' | 'excel' }) {
  const { t } = useTranslation()
  const cases = templates.filter(item => item.mode === section)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 py-10" data-testid={`office-section-${section}`}>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(section === 'word' ? 'office.section.wordTitle' : 'office.section.excelTitle')}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        {t(section === 'word' ? 'office.section.wordEmpty' : 'office.section.excelEmpty')}
      </p>
      <ul className="mt-8 grid max-w-3xl gap-3">
        {cases.map(item => (
          <li key={item.id} className="rounded-xl border border-border/70 bg-background px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">{item.title}</h2>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.id}@{item.revision}</span>
            </div>
            {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
            {(item.businessSkills?.length || item.businessSkill) ? (
              <p className="mt-2 text-xs text-muted-foreground">{(item.businessSkills ?? [item.businessSkill]).filter(Boolean).join('、')}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">{t('office.section.skillPending')}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
