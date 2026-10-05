import { useId, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import swan from '@/assets/selection-swan-trimmed.svg'
import wordmark from '@/assets/selection-wordmark.svg'
import './pro-identity-dialog.css'

export function ProIdentityDialog({ open, onOpenChange, trigger }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: RefObject<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  const glintClip = useId()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pro-identity-backdrop fixed inset-0 z-modal" />
        <Dialog.Content
          className="pro-identity-content fixed inset-0 z-modal flex select-none items-center justify-center p-6 outline-none"
          onPointerDown={event => { if (event.target === event.currentTarget) onOpenChange(false) }}
          onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}
        >
          <Dialog.Title className="sr-only">Selection PRO</Dialog.Title>
          <Dialog.Description className="sr-only">{t('session.currentProMode')}</Dialog.Description>
          <div className="pro-identity-lockup pointer-events-none flex items-end" aria-hidden="true">
            <div className="pro-identity-brand flex shrink-0 items-end">
              {/* Animate the wrappers so blur never overrides the image's theme inversion. */}
              <div className="pro-identity-mark"><img src={swan} alt="" draggable={false} className="h-full w-auto" /></div>
              <div className="pro-identity-label flex items-center">
                <div className="pro-identity-wordmark"><img src={wordmark} alt="" draggable={false} className="h-full w-auto" /></div>
                <svg className="pro-identity-mode" viewBox="32 10 104 34">
                  <defs>
                    <clipPath id={glintClip}>
                      <rect className="pro-identity-glint-window" x="-50" y="0" width="24" height="54" />
                    </clipPath>
                  </defs>
                  <text x="84" y="40" textAnchor="middle" className="pro-identity-outline">PRO</text>
                  <text x="84" y="40" textAnchor="middle" className="pro-identity-fill">PRO</text>
                  <text x="84" y="40" textAnchor="middle" clipPath={`url(#${glintClip})`} className="pro-identity-glint">PRO</text>
                </svg>
              </div>
            </div>
          </div>
          <Dialog.Close asChild>
            <button type="button" aria-label={t('common.close')}
              className="absolute right-6 top-6 flex size-9 items-center justify-center text-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pro-accent)]">
              <X className="size-5" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
