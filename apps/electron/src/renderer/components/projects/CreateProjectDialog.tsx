/**
 * CreateProjectDialog — Name plus a required working folder.
 *
 * The folder is chosen with the native picker (or the server browser when
 * the app is remote). An empty name is filled from the folder name unless
 * the user has already typed one.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
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
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { cn } from '@/lib/utils'
import {
  createProjectBlocker,
  suggestProjectNameFromFolder,
} from '@craft-agent/shared/projects/working-directory'
import { shouldSubmitProjectNameOnKeyDown } from './project-name-submit'

interface CreateProjectDialogProps {
  open: boolean
  onCancel: () => void
  onSubmit: (input: { name: string; workingDirectory: string }) => void
  /** Playground and tests can supply a folder instead of the native dialog. */
  pickFolder?: () => Promise<string | null | undefined>
}

export function CreateProjectDialog({ open, onCancel, onSubmit, pickFolder }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const [folder, setFolder] = React.useState('')
  const [suggestion, setSuggestion] = React.useState('')
  const [attempted, setAttempted] = React.useState(false)
  const isComposingRef = React.useRef(false)
  const nameRef = React.useRef(name)
  const suggestionRef = React.useRef(suggestion)
  nameRef.current = name
  suggestionRef.current = suggestion

  useRegisterModal(open, onCancel)

  React.useEffect(() => {
    if (open) {
      setName('')
      setFolder('')
      setSuggestion('')
      setAttempted(false)
      isComposingRef.current = false
    }
  }, [open])

  const applyFolder = React.useCallback((path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    const next = suggestProjectNameFromFolder({
      currentName: nameRef.current,
      previousSuggestion: suggestionRef.current,
      folderPath: trimmed,
    })
    setFolder(trimmed)
    setName(next.name)
    setSuggestion(next.suggestion)
    setAttempted(false)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(applyFolder)

  const blocker = createProjectBlocker({ name, workingDirectory: folder })
  const showFolderError = attempted && blocker === 'folder'

  const handleChooseFolder = () => {
    if (pickFolder) {
      void pickFolder().then((path) => {
        if (typeof path === 'string') applyFolder(path)
      })
      return
    }
    pickDirectory()
  }

  const handleSubmit = () => {
    if (blocker) {
      setAttempted(true)
      return
    }
    onSubmit({ name: name.trim(), workingDirectory: folder.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('projectsList.createDialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t('projectsList.createDialogFolderLabel')}</div>
            <div
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-background px-3 py-3',
                showFolderError ? 'border-destructive/60' : 'border-border/60',
              )}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-foreground/70" />
              <p className={cn('min-w-0 flex-1 truncate text-sm', folder ? 'font-mono text-foreground' : 'text-muted-foreground')}>
                {folder || t('projectsList.createDialogFolderPlaceholder')}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleChooseFolder}>
                {t('projectsList.createDialogFolderButton')}
              </Button>
            </div>
            <p className={cn('text-xs', showFolderError ? 'text-destructive' : 'text-muted-foreground')}>
              {showFolderError ? t('projectsList.createDialogFolderRequired') : t('projectsList.createDialogFolderHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="create-project-name">
              {t('projectInfo.title')}
            </label>
            <Input
              id="create-project-name"
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
                isComposingRef.current = false
              }}
              onKeyDown={(e) => {
                if (shouldSubmitProjectNameOnKeyDown(e.nativeEvent, blocker === null, isComposingRef.current)) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
              {attempted && blocker === 'name' && (
              <p className="text-xs text-destructive">{t('projectsList.createDialogNameRequired')}</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit}>
            {t('projectsList.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
      {!pickFolder && (
        <ServerDirectoryBrowser
          open={showServerBrowser}
          mode={serverBrowserMode}
          onSelect={confirmServerBrowser}
          onCancel={cancelServerBrowser}
          initialPath={folder || undefined}
        />
      )}
    </Dialog>
  )
}
