import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Presentation } from 'lucide-react'
import { pptComposerAtomFamily, pptComposerOverrideAtomFamily, replacePptTemplate } from '@/atoms/ppt'
import { FreeFormInputContextBadge } from '@/components/app-shell/input/FreeFormInputContextBadge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NavigationContext, routes } from '@/contexts/NavigationContext'
import { TemplateGallery } from './TemplateGallery'
import { queueTemplateFlight } from './SelectedTemplate'

export function PptPickerButton({ composerKey, disabled, pptMode }: { composerKey: string; disabled?: boolean; pptMode?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const navigation = React.useContext(NavigationContext)
  const setRequest = useSetAtom(pptComposerAtomFamily(composerKey))
  const selectedId = useAtomValue(pptComposerOverrideAtomFamily(composerKey))?.templateId
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FreeFormInputContextBadge
          icon={<Presentation className="h-4 w-4" />}
          label={t('ppt.buttonLabel')}
          isExpanded
          hasSelection
          showChevron={false}
          isOpen={open}
          disabled={disabled}
          title={t(pptMode ? 'ppt.skillHint' : 'ppt.pickerHint')}
          data-testid="ppt-picker-button"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="flex max-h-[min(440px,70vh)] w-[min(560px,90vw)] flex-col overflow-hidden p-3"
        data-testid="ppt-picker-popover"
      >
        <div className="mb-2 flex items-center gap-2 px-1">
          <Presentation className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{t('ppt.pickerTitle')}</h3>
          <span className="shrink-0 text-[11px] text-muted-foreground">{t(pptMode ? 'ppt.skillHint' : 'ppt.pickerHint')}</span>
        </div>
        <div className="min-h-0 flex-auto overflow-y-auto px-1">
          <TemplateGallery
            compact
            selectedId={selectedId}
            onSelect={(template, source) => {
              queueTemplateFlight(composerKey, source)
              setRequest(value => replacePptTemplate(value, template.id))
              setOpen(false)
            }}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border/50 px-1 pt-2.5">
          <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">{t('ppt.pickerFooter')}</p>
          {navigation && (
            <button
              type="button"
              className="ml-auto h-7 shrink-0 rounded-md px-2.5 text-xs hover:bg-foreground/5"
              onClick={() => {
                setOpen(false)
                void navigation.navigate(routes.view.ppt())
              }}
            >
              {t('ppt.viewAll')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
