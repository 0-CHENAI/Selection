import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DISPLAY_TITLE_MAX_LENGTH } from '@craft-agent/shared/display-titles'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { cn } from '@/lib/utils'

type DisplayTitleKind = 'source' | 'skill'

export type DisplayTitleRenameTarget = {
  displayTitle?: string
  defaultTitle: string
}

export function DisplayTitleField({
  customTitle,
  onRename,
}: {
  customTitle?: string
  onRename: () => void
}) {
  const { t } = useTranslation()
  const alias = customTitle?.trim()
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <span className={cn('truncate', !alias && 'text-muted-foreground')}>
        {alias || t('displayTitle.usingDefault')}
      </span>
      <button
        type="button"
        onClick={onRename}
        className="shrink-0 text-muted-foreground hover:text-foreground hover:underline"
      >
        {t('common.rename')}
      </button>
    </div>
  )
}

export function useDisplayTitleRename(
  kind: DisplayTitleKind,
  workspaceId: string | null | undefined,
  workingDirectory?: string,
) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [slug, setSlug] = React.useState<string | null>(null)
  const [defaultTitle, setDefaultTitle] = React.useState('')
  const [value, setValue] = React.useState('')

  const start = React.useCallback((id: string, target: DisplayTitleRenameTarget) => {
    setSlug(id)
    setDefaultTitle(target.defaultTitle)
    setValue(target.displayTitle?.trim() ?? '')
    setOpen(true)
  }, [])

  const submit = React.useCallback(async () => {
    if (!workspaceId || !slug) return
    try {
      const result = kind === 'source'
        ? await window.electronAPI.setSourceDisplayTitle(workspaceId, slug, value)
        : await window.electronAPI.setSkillDisplayTitle(workspaceId, slug, value, workingDirectory)
      setOpen(false)
      toast.success(result.displayTitle ? t('displayTitle.updated') : t('displayTitle.restored'))
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      const isTooLong = err instanceof Error && (
        err.name === 'DisplayTitleValidationError'
        || /characters or fewer|too_long|must be \d+ characters/i.test(message)
      )
      toast.error(isTooLong || !message
        ? t('displayTitle.tooLong', { max: DISPLAY_TITLE_MAX_LENGTH })
        : message)
    }
  }, [kind, slug, t, value, workingDirectory, workspaceId])

  const dialog = (
    <RenameDialog
      open={open}
      onOpenChange={setOpen}
      title={kind === 'source' ? t('displayTitle.renameSource') : t('displayTitle.renameSkill')}
      value={value}
      onValueChange={setValue}
      onSubmit={submit}
      allowEmpty
      maxLength={DISPLAY_TITLE_MAX_LENGTH}
      placeholder={defaultTitle}
      description={t('displayTitle.hint')}
    />
  )

  return { start, dialog }
}
