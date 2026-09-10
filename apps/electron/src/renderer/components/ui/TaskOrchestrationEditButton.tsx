import * as React from 'react'
import { Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PanelHeaderCenterButton } from './PanelHeaderCenterButton'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { Button } from './button'

interface TaskOrchestrationEditButtonProps {
  compact?: boolean
  disabled?: boolean
  onEdit: () => void
}

/** Touch/compact activation explains the destination before leaving the chat. */
export function TaskOrchestrationEditButton({ compact = false, disabled, onEdit }: TaskOrchestrationEditButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const pointerType = React.useRef('')
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const restoreTriggerFocus = React.useRef(true)
  const descriptionId = React.useId()
  const titleId = React.useId()
  const title = t('kanban.editOrchestration')
  const description = t('kanban.editOrchestrationDescription')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <PanelHeaderCenterButton
          ref={triggerRef}
          icon={<Workflow className="h-4 w-4" aria-hidden="true" />}
          tooltip={title}
          tooltipDisabled={open}
          tooltipDescription={description}
          aria-label={title}
          aria-describedby={descriptionId}
          aria-haspopup={compact || open ? 'dialog' : undefined}
          aria-expanded={compact || open ? open : undefined}
          disabled={disabled}
          onPointerDown={(event) => { pointerType.current = event.pointerType }}
          onClick={(event) => {
            // Keyboard clicks must not inherit a previous touch/pen interaction.
            const touch = event.detail !== 0 && (pointerType.current === 'touch' || pointerType.current === 'pen')
            pointerType.current = ''
            if (compact || touch) {
              restoreTriggerFocus.current = true
              setOpen(true)
            } else onEdit()
          }}
        />
      </PopoverAnchor>
      <span id={descriptionId} className="sr-only">{description}</span>
      <PopoverContent
        onKeyDown={(event) => {
          // The tooltip's exit layer can briefly remain above this popover.
          // Escape from within the explanation must still dismiss it at once.
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
        }}
        onInteractOutside={() => { restoreTriggerFocus.current = false }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (restoreTriggerFocus.current) triggerRef.current?.focus()
        }}
        side="bottom"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="text-sm font-medium">{title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
        <Button className="mt-3 w-full" size="sm" disabled={disabled} onClick={() => { restoreTriggerFocus.current = false; setOpen(false); onEdit() }}>
          {t('kanban.openOrchestrationEditor')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
