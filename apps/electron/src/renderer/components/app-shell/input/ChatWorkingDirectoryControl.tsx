import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Icon_Folder, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { cn } from '@/lib/utils'
import { addRecentWorkingDir } from './working-directory-history'
import { deriveSelectionFlags } from './use-working-directory-state'
import './chat-working-directory-control.css'

/** Ordinary chats only. Project conversations render ProjectWorkingDirectoryMark. */
export function ChatWorkingDirectoryControl({
  workingDirectory,
  sessionFolderPath,
  workspaceId,
  onWorkingDirectoryChange,
  isEmptySession = false,
  disabled = false,
}: {
  workingDirectory?: string
  sessionFolderPath?: string
  workspaceId?: string
  onWorkingDirectoryChange: (path: string) => void
  isEmptySession?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const pickerRef = React.useRef<HTMLButtonElement>(null)
  const mounted = React.useRef(false)
  const latest = React.useRef({ disabled, workingDirectory, onWorkingDirectoryChange })
  const generation = React.useRef(0)
  if (latest.current.disabled !== disabled || latest.current.workingDirectory !== workingDirectory) generation.current++
  latest.current = { disabled, workingDirectory, onWorkingDirectoryChange }
  const selectionGeneration = generation.current
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const onSelect = React.useCallback((path: string) => {
    // Ignore native-dialog results after unmount, a running turn, or another
    // directory change. The composer keys this control by session/draft scope.
    if (!mounted.current || latest.current.disabled || generation.current !== selectionGeneration) return
    addRecentWorkingDir(path, workspaceId)
    latest.current.onWorkingDirectoryChange(path)
  }, [selectionGeneration, workspaceId])
  const { pickDirectory, isPicking, showServerBrowser, serverBrowserMode, cancelServerBrowser, confirmServerBrowser } = useDirectoryPicker(onSelect)
  const { hasFolder, folderName } = deriveSelectionFlags(workingDirectory, sessionFolderPath, true)
  const label = folderName || t('chat.workInFolder')
  const pickerLabel = t('chat.chooseWorkingDirectory')
  const clearLabel = t('chat.clearWorkingDirectory')
  const unavailable = disabled || isPicking

  return (
    <>
      <span className="working-directory-control group relative inline-flex min-w-0 shrink items-center rounded-[6px] text-foreground" data-selected={hasFolder || undefined}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={pickerRef}
              type="button"
              aria-label={hasFolder ? `${pickerLabel}: ${workingDirectory}` : pickerLabel}
              disabled={unavailable}
              onClick={() => { void pickDirectory() }}
              className={cn(
                'input-toolbar-btn inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] text-[13px] outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                hasFolder || isEmptySession ? 'px-2' : 'px-1.5',
              )}
            >
              <Icon_Folder className="h-4 w-4 shrink-0" />
              {(hasFolder || isEmptySession) && (
                <span className={cn('working-directory-control-label block min-w-0 max-w-[140px] truncate', !hasFolder && 'opacity-50')}>{label}</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{hasFolder ? workingDirectory : pickerLabel}</TooltipContent>
        </Tooltip>
        {hasFolder && (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            disabled={unavailable}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (unavailable) return
              onWorkingDirectoryChange(sessionFolderPath ?? 'none')
              pickerRef.current?.focus()
            }}
            className="working-directory-control-clear absolute right-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-[6px] border-0 bg-transparent text-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      <ServerDirectoryBrowser
        open={showServerBrowser && !disabled}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
        initialPath={hasFolder ? workingDirectory : undefined}
      />
    </>
  )
}
