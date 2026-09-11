import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LoadedProject } from '@craft-agent/shared/projects/types'
import { confirmAction } from '@/lib/confirmation'
import { getFileManagerName } from '@/lib/platform'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'

export function ProjectFolderActions({ project, workspaceId }: {
  project: LoadedProject
  workspaceId: string
}) {
  const { t } = useTranslation()
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function rename() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, { name: trimmed })
      setRenameOpen(false)
      toast.success(t('projectInfo.saved'))
    } catch {
      toast.error(t('projectInfo.saveFailed'))
    }
  }

  async function showInFolder() {
    try {
      await window.electronAPI.showInFolder(project.folderPath)
    } catch {
      toast.error(t('toast.failedToOpenFile'))
    }
  }

  async function deleteProject() {
    if (deleting) return
    setDeleting(true)
    try {
      if (!await confirmAction(t('projectInfo.deleteConfirm', { name: project.config.name }))) return
      await window.electronAPI.deleteProject(workspaceId, project.config.slug)
      toast.success(t('projectsList.deleted', { name: project.config.name }))
    } catch {
      toast.error(t('projectsList.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('projectsList.folderActions', { name: project.config.name })}
            data-touch-reveal="true"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-foreground/50 opacity-0 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={() => {
            setName(project.config.name)
            setRenameOpen(true)
          }}>
            <Pencil className="h-3.5 w-3.5" />
            <span className="flex-1">{t('common.rename')}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem onClick={showInFolder}>
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem onClick={deleteProject} variant="destructive" disabled={deleting}>
            <Trash2 className="h-3.5 w-3.5" />
            <span className="flex-1">{t('projectsList.delete')}</span>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('common.rename')}
        value={name}
        onValueChange={setName}
        onSubmit={rename}
      />
    </>
  )
}
