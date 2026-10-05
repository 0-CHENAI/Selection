import { lazy, Suspense, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import './pro-identity-dialog.css'

const ProIdentityLockup = lazy(() => import('./ProIdentityLockup'))

export function ProIdentityDialog({ open, onOpenChange, trigger }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: RefObject<HTMLButtonElement>
}) {
  const { t } = useTranslation()
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
          <Suspense fallback={null}>
            <ProIdentityLockup open={open} />
          </Suspense>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
