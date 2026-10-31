import { useAtom } from 'jotai'
import { FileText, Table2 } from 'lucide-react'
import catalog from '../../../../resources/skills/office-business/catalog.json'
import { officeComposerAtomFamily } from '@/atoms/office'
import { cn } from '@/lib/utils'
import { officeCaseCovers } from './office-covers'
import { casesForOfficeHome } from './office-home'

type OfficeCase = {
  id: string
  title: string
  mode: 'word' | 'excel'
  revision: string
  description?: string
  category?: string
  businessSkill?: string
  businessSkills?: string[]
}

const cases = (catalog as { cases?: OfficeCase[] }).cases ?? []

export function OfficeCaseGallery({ mode, composerKey }: { mode: 'word' | 'excel'; composerKey: string }) {
  const [request, setRequest] = useAtom(officeComposerAtomFamily(composerKey))
  const items = casesForOfficeHome(cases, mode)
  const Icon = mode === 'word' ? FileText : Table2
  return (
    <div className="mx-auto mt-7 w-full max-w-[1000px] min-h-0 overflow-y-auto px-8 pb-8" data-testid={`office-case-gallery-${mode}`}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
        {items.map(item => {
          const selected = request?.mode === mode && request.templateId === item.id
          return (
            <article key={item.id} className="min-w-0">
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
              <p title={item.title} className="mt-2 truncate text-[13px]">{item.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.category}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}
