import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, X } from 'lucide-react'
import { confirmationController, confirmClientDialog, rememberConfirmationFocus } from '@/lib/confirmation'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from './ui/alert-dialog'
import { Button } from './ui/button'

export function ConfirmationHost() {
  const { t } = useTranslation()
  const request = useSyncExternalStore(confirmationController.subscribe, confirmationController.getSnapshot)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const lastRequest = useRef(request)
  if (request) lastRequest.current = request
  const displayed = request ?? lastRequest.current
  // Each request starts unacknowledged, so a previous tick never carries over.
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => { if (request) setAcknowledged(false) }, [request])
  useEffect(() => window.electronAPI?.onConfirmDialog?.(confirmClientDialog), [])
  useEffect(() => {
    document.addEventListener('focusin', rememberConfirmationFocus)
    return () => document.removeEventListener('focusin', rememberConfirmationFocus)
  }, [])

  const needsAcknowledgement = !!displayed?.acknowledgeLabel
  const canConfirm = !needsAcknowledgement || acknowledged

  return <AlertDialog open={!!request} onOpenChange={open => { if (!open) confirmationController.settle(false) }}>
    <AlertDialogContent
      className="flex max-h-[82dvh] flex-col overflow-hidden"
      overlayClassName="bg-black/15 dark:bg-black/35"
      onEscapeKeyDown={event => event.stopPropagation()}
      onOpenAutoFocus={event => {
        event.preventDefault()
        returnFocus.current = request?.returnFocus ?? null
        cancelRef.current?.focus()
      }}
      onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }}
    >
      <AlertDialogHeader className="shrink-0 flex-row items-start justify-between gap-3 text-left">
        <AlertDialogTitle>{displayed?.title}</AlertDialogTitle>
        {needsAcknowledgement && (
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => confirmationController.settle(false)}
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </AlertDialogHeader>
      <AlertDialogDescription asChild={!!displayed?.warning} className="min-h-0 overflow-y-auto break-words">
        {displayed?.warning ? (
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <p>{displayed.message}{displayed.detail && <><br />{displayed.detail}</>}</p>
          </div>
        ) : (
          <>{displayed?.message}{displayed?.detail && <><br />{displayed.detail}</>}</>
        )}
      </AlertDialogDescription>
      {needsAcknowledgement && (
        <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={event => setAcknowledged(event.target.checked)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-foreground"
          />
          {displayed?.acknowledgeLabel}
        </label>
      )}
      <AlertDialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t border-border pt-4">
        <Button ref={cancelRef} variant="outline" onClick={() => confirmationController.settle(false)}>{displayed?.cancelLabel}</Button>
        <Button
          variant={displayed?.destructive ? 'destructive' : 'default'}
          disabled={!canConfirm}
          onClick={() => { if (canConfirm) confirmationController.settle(true) }}
        >{displayed?.confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
