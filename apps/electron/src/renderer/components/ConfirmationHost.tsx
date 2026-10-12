import { useEffect, useRef, useSyncExternalStore } from 'react'
import { confirmationController, confirmClientDialog, rememberConfirmationFocus } from '@/lib/confirmation'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from './ui/alert-dialog'
import { Button } from './ui/button'

export function ConfirmationHost() {
  const request = useSyncExternalStore(confirmationController.subscribe, confirmationController.getSnapshot)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const lastRequest = useRef(request)
  if (request) lastRequest.current = request
  const displayed = request ?? lastRequest.current
  useEffect(() => window.electronAPI?.onConfirmDialog?.(confirmClientDialog), [])
  useEffect(() => {
    document.addEventListener('focusin', rememberConfirmationFocus)
    return () => document.removeEventListener('focusin', rememberConfirmationFocus)
  }, [])

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
      <AlertDialogHeader className="shrink-0 text-left">
        <AlertDialogTitle>{displayed?.title}</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogDescription className="min-h-0 overflow-y-auto break-words">{displayed?.message}{displayed?.detail && <><br />{displayed.detail}</>}</AlertDialogDescription>
      <AlertDialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t border-border pt-4">
        <Button ref={cancelRef} variant="outline" onClick={() => confirmationController.settle(false)}>{displayed?.cancelLabel}</Button>
        <Button variant={displayed?.destructive ? 'destructive' : 'default'} onClick={() => confirmationController.settle(true)}>{displayed?.confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
