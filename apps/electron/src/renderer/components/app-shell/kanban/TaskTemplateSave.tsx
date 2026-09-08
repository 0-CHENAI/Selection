import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function TaskTemplateSaveDialog({
  open,
  defaultName,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  defaultName: string
  busy?: boolean
  error?: string
  onClose: () => void
  onSubmit: (input: { name: string; description: string; tags: string[] }) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = React.useState(defaultName)
  const [description, setDescription] = React.useState('')
  const [tags, setTags] = React.useState('')
  React.useEffect(() => {
    if (open) {
      setName(defaultName)
      setDescription('')
      setTags('')
    }
  }, [open, defaultName])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('tasks.templateSave')}</DialogTitle>
          <DialogDescription>{t('tasks.templateSaveHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="font-medium">{t('tasks.templateName')}</span>
            <input
              className="h-8 rounded-md border border-border bg-background px-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="font-medium">{t('tasks.templateDescription')}</span>
            <textarea
              className="min-h-16 rounded-md border border-border bg-background px-2 py-1"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="font-medium">{t('tasks.templateTags')}</span>
            <input
              className="h-8 rounded-md border border-border bg-background px-2"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              disabled={busy}
            />
          </label>
          {error && <p role="alert" className="text-[12.5px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => onSubmit({
            name: name.trim(),
            description: description.trim(),
            tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          })}>
            {t('tasks.templateSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
