import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Presentation, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  consumeOfficeSwitcherFocus,
  nextOfficeSection,
  OFFICE_HOME_SECTIONS,
  requestOfficeSwitcherFocus,
  type OfficeHomeSection,
} from './office-home'

const icons = {
  ppt: Presentation,
  word: FileText,
  excel: Table2,
} as const

export function OfficeModeSwitcher({
  section,
  onChange,
}: {
  section: OfficeHomeSection
  onChange: (section: OfficeHomeSection) => void
}) {
  const { t } = useTranslation()
  const selectedRef = React.useRef<HTMLButtonElement>(null)
  React.useLayoutEffect(() => {
    if (consumeOfficeSwitcherFocus()) selectedRef.current?.focus()
  }, [section])
  const choose = (next: OfficeHomeSection, fromKeyboard = false) => {
    if (fromKeyboard) requestOfficeSwitcherFocus()
    if (next !== section) onChange(next)
  }
  return (
    <div
      role="radiogroup"
      aria-label={t('office.section.switcher')}
      data-testid="office-mode-switcher"
      className="mb-2 flex items-center gap-0.5"
      onKeyDown={event => {
        const next = nextOfficeSection(section, event.key)
        if (!next) return
        event.preventDefault()
        choose(next, true)
      }}
    >
      {OFFICE_HOME_SECTIONS.map(item => {
        const Icon = icons[item]
        const selected = item === section
        return (
          <button
            key={item}
            ref={selected ? selectedRef : undefined}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`office-mode-${item}`}
            data-selected={selected ? 'true' : 'false'}
            onClick={() => choose(item)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[8px] border-0 bg-transparent px-2',
              'text-[13px] font-medium leading-5 text-foreground',
              'transition-colors motion-reduce:transition-none',
              'hover:bg-foreground/5',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'active:scale-[0.98] motion-reduce:active:scale-100',
              selected && 'bg-accent/10 text-accent hover:bg-accent/10',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`office.history.${item}`)}
          </button>
        )
      })}
    </div>
  )
}
