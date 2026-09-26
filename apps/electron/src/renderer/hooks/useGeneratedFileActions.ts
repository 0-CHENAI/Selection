import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePlatform } from '@craft-agent/ui'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { generatedFileBaseDirs } from '@/lib/generated-file-path'
import { openGeneratedFileAction, type GeneratedArtifactAction } from '@/lib/generated-file-actions'

/** All generated-file actions resolve against the owning session before opening. */
export function useGeneratedFileActions(opts: {
  workingDirectory?: string | null
  sessionFolderPath?: string | null
  workspaceRootPath?: string | null
  onOpenFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const { onOpenFileExternal } = usePlatform()
  const { onOpenFile, workingDirectory, sessionFolderPath, workspaceRootPath } = opts
  const baseDirs = React.useMemo(() => generatedFileBaseDirs({
    workingDirectory, sessionFolderPath, workspaceRootPath,
  }), [workingDirectory, sessionFolderPath, workspaceRootPath])
  const baseDir = baseDirs[0]
  const openArtifact = React.useCallback(async (path: string, action: GeneratedArtifactAction) => {
    try {
      await openGeneratedFileAction({
        requestedPath: path,
        action,
        baseDir,
        baseDirs,
        statPath: window.electronAPI.isChannelAvailable(RPC_CHANNELS.fs.STAT_PATH)
          ? (candidate) => window.electronAPI.statPath(candidate)
          : undefined,
        searchFiles: (dir, query) => window.electronAPI.searchFiles(dir, query),
        openPreview: onOpenFile,
        openExternal: onOpenFileExternal,
        reveal: (resolvedPath) => window.electronAPI.showInFolder(resolvedPath),
      })
    } catch (error) {
      toast.error(t('toast.failedToOpenFile'), { description: error instanceof Error ? error.message : String(error) })
    }
  }, [baseDir, baseDirs, onOpenFile, onOpenFileExternal, t])
  const openFile = React.useCallback((path: string) => {
    void openArtifact(path, 'preview')
  }, [openArtifact])
  return { openArtifact, openFile }
}
