import { Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PanelHeaderCenterButton } from './PanelHeaderCenterButton'
import type { RefObject } from 'react'

export function TaskGraphButton({ open, onOpen, triggerRef }: { open: boolean; onOpen: () => void; triggerRef?: RefObject<HTMLButtonElement> }) {
  const { t } = useTranslation()
  return <PanelHeaderCenterButton
    ref={triggerRef}
    icon={<Workflow className="h-4 w-4" aria-hidden="true" />}
    tooltip={t('tasks.graphTitle')}
    tooltipDescription={t('tasks.graphDescription')}
    tooltipDisabled={open}
    aria-label={t('tasks.graphTitle')}
    aria-haspopup="dialog"
    aria-expanded={open}
    onClick={onOpen}
  />
}
