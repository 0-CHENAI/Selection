/**
 * CreateProjectDialog — Prompts the user for a project name before creating it.
 *
 * Avoids the "new-project / new-project-1 / new-project-2" slug pile-up
 * that came from auto-creating with a default name. Name is required.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegisterModal } from '@/context/ModalContext'
import { shouldSubmitProjectNameOnKeyDown } from './project-name-submit'

interface CreateProjectDialogProps {
  open: boolean
  onCancel: () => void
  /** Called with the trimmed name when the user confirms. */
  onSubmit: (name: string) => void
}

export function CreateProjectDialog({ open, onCancel, onSubmit }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const isComposingRef = React.useRef(false)

  // Register with modal context so X / Cmd+W closes the dialog first
  useRegisterModal(open, onCancel)

  // Reset name whenever the dialog opens
  React.useEffect(() => {
    if (open) {
      setName('')
      isComposingRef.current = false
    }
  }, [open])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  const handleCancel = () => {
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projectsList.createDialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="pt-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projectsList.createDialogNamePlaceholder')}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            onBlur={() => {
              // A focus change ends or cancels IME input even if the browser
              // does not deliver compositionend before the element blurs.
              isComposingRef.current = false
            }}
            onKeyDown={(e) => {
              if (shouldSubmitProjectNameOnKeyDown(e.nativeEvent, canSubmit, isComposingRef.current)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {t('projectsList.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
