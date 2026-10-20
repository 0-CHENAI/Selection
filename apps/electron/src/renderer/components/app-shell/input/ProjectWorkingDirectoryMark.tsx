/**
 * Read-only working-folder mark for a project conversation.
 * The folder comes from the project. Hover shows the full path.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Icon_Folder, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { getPathBasename } from '@/lib/platform'
import { cn } from '@/lib/utils'

export function ProjectWorkingDirectoryMark({
  workingDirectory,
}: {
  workingDirectory?: string
  /** Accepted for call-site compatibility. Empty and ongoing sessions share the same borderless mark. */
  isEmptySession?: boolean
}) {
  const { t } = useTranslation()
  const folder = workingDirectory?.trim()
  const name = folder ? getPathBasename(folder) : t('chat.projectWorkingDirectoryMissing')
  const label = folder
    ? `${t('chat.projectWorkingDirectory')}: ${folder}`
    : t('chat.projectWorkingDirectoryMissingHint')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex h-7 min-w-0 shrink cursor-default items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-foreground outline-none transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring',
            !folder && 'text-amber-800 dark:text-amber-200',
          )}
          role="note"
          aria-disabled="true"
          aria-label={label}
          title={folder ? `${t('chat.projectWorkingDirectory')}\n${folder}` : undefined}
        >
          <Icon_Folder className="h-4 w-4 shrink-0" />
          <span className="max-w-[140px] truncate">{name}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {folder ? (
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t('chat.projectWorkingDirectory')}</span>
            <span className="text-xs opacity-70">{folder}</span>
          </span>
        ) : (
          t('chat.projectWorkingDirectoryMissingHint')
        )}
      </TooltipContent>
    </Tooltip>
  )
}
