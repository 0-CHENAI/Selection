import { confirmAction } from '@/lib/confirmation'
/**
 * ProjectInfoPage
 *
 * One scrolling project page. Settings share a single save button; resources
 * sit after it and apply on upload or delete. Sessions are not listed here.
 * They stay on the session list, still bound by projectId. The sidebar
 * project item opens that filtered list. The middle project column stays,
 * because compact layout hides the sidebar and that column is the index.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback } from 'react'
import { FolderKanban, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import {
  Info_Page,
} from '@/components/info'
import { Button } from '@/components/ui/button'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
import { mergeProjectSettingsRefresh, projectSettingsDraftDirty, projectSettingsDraftFromConfig } from '@/components/projects/project-settings-draft'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { projectWorkingDirectorySaveIssue } from '@craft-agent/shared/projects/working-directory'
import type { LoadedProject, ProjectAsset } from '@craft-agent/shared/projects/types'

interface ProjectInfoPageProps {
  projectSlug: string
}

export default function ProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const { onOpenFile } = useAppShellContext()

  const [project, setProject] = useState<LoadedProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editWorkingDir, setEditWorkingDir] = useState('')
  const [editDetails, setEditDetails] = useState('')
  const [editHistorySearch, setEditHistorySearch] = useState(false)
  const [editColor, setEditColor] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [folderError, setFolderError] = useState<'cleared' | null>(null)
  const projectRef = React.useRef(project)
  const draftRef = React.useRef({
    name: editName,
    description: editDescription,
    workingDirectory: editWorkingDir,
    details: editDetails,
    historySearch: editHistorySearch,
    color: editColor,
  })
  projectRef.current = project
  draftRef.current = {
    name: editName,
    description: editDescription,
    workingDirectory: editWorkingDir,
    details: editDetails,
    historySearch: editHistorySearch,
    color: editColor,
  }

  // Load project (and re-load on broadcast). A refresh must not replace the
  // page with a spinner or discard unsaved edits.
  const loadProject = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!workspaceId) return
    if (mode === 'initial') {
      setLoading(true)
      setError(null)
    }
    try {
      const result = await window.electronAPI.getProject(workspaceId, projectSlug)
      if (!result) {
        setError(t('projectInfo.notFound'))
        setProject(null)
        return
      }
      const loaded = result as LoadedProject
      const stored = projectSettingsDraftFromConfig(loaded.config)
      const current = projectRef.current
      const previous = current ? projectSettingsDraftFromConfig(current.config) : stored
      const preserveEdits = mode === 'refresh' && !!current
        && projectSettingsDraftDirty(previous, draftRef.current)
      const nextDraft = preserveEdits
        ? mergeProjectSettingsRefresh(previous, stored, draftRef.current)
        : stored
      setProject(loaded)
      setEditName(nextDraft.name)
      setEditDescription(nextDraft.description)
      setEditWorkingDir(nextDraft.workingDirectory)
      setEditDetails(nextDraft.details)
      setEditHistorySearch(nextDraft.historySearch)
      setEditColor(nextDraft.color)
      if (!preserveEdits || nextDraft.workingDirectory === stored.workingDirectory) {
        setFolderError(null)
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load project:', err)
      if (mode === 'initial' || !projectRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (mode === 'initial') setLoading(false)
    }
  }, [workspaceId, projectSlug, t])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  useEffect(() => {
    if (!workspaceId) return
    const off = window.electronAPI.onProjectsChanged((wsId: string) => {
      if (wsId === workspaceId) void loadProject('refresh')
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [workspaceId, loadProject])

  const refreshAssets = useCallback(async () => {
    if (!workspaceId) return
    try {
      const list = await window.electronAPI.listProjectAssets(workspaceId, projectSlug)
      setAssets(Array.isArray(list) ? (list as ProjectAsset[]) : [])
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load assets:', err)
    }
  }, [workspaceId, projectSlug])

  useEffect(() => {
    void refreshAssets()
  }, [refreshAssets])

  const handlePickWorkingDirectory = useCallback((path: string) => {
    if (!path.trim()) return
    setEditWorkingDir(path)
    setFolderError(null)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handlePickWorkingDirectory)

  const handleSaveSettings = useCallback(async () => {
    if (!workspaceId || !project) return
    const issue = projectWorkingDirectorySaveIssue({
      storedWorkingDirectory: project.config.workingDirectory,
      nextWorkingDirectory: editWorkingDir,
    })
    if (issue === 'cleared') {
      setFolderError('cleared')
      return
    }
    setFolderError(null)
    setSaving(true)
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, {
        name: editName.trim() || project.config.name,
        description: editDescription.trim() || undefined,
        workingDirectory: editWorkingDir.trim() || undefined,
        details: editDetails.trim() || undefined,
        historySearchEnabled: editHistorySearch,
        color: editColor.trim() || undefined,
      })
      toast.success(t('projectInfo.saved'))
    } catch (err) {
      console.error('[ProjectInfoPage] Save failed:', err)
      toast.error(t('projectInfo.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [workspaceId, project, editName, editDescription, editWorkingDir, editDetails, editHistorySearch, editColor, t])

  const handleDeleteProject = useCallback(async () => {
    if (!workspaceId || !project) return
    if (!await confirmAction(t('projectInfo.deleteConfirm', { name: project.config.name }))) return
    try {
      await window.electronAPI.deleteProject(workspaceId, project.config.slug)
      navigate(routes.view.projects())
    } catch (err) {
      console.error('[ProjectInfoPage] Delete failed:', err)
      toast.error(t('projectInfo.deleteFailed'))
    }
  }, [workspaceId, project, t])

  const handleUpload = useCallback(async (file: File) => {
    if (!workspaceId || !project) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, {
        filename: file.name,
        base64,
      })
      await refreshAssets()
      toast.success(t('projectInfo.assetUploaded', { name: file.name }))
    } catch (err) {
      console.error('[ProjectInfoPage] Upload failed:', err)
      toast.error(t('projectInfo.uploadFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  const handleDeleteAsset = useCallback(async (asset: ProjectAsset) => {
    if (!workspaceId || !project) return
    if (!await confirmAction(t('projectInfo.deleteAssetConfirm', { name: asset.filename }))) return
    try {
      await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, asset.filename)
      await refreshAssets()
    } catch (err) {
      console.error('[ProjectInfoPage] Asset delete failed:', err)
      toast.error(t('projectInfo.deleteAssetFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!project && !loading && !error ? t('projectInfo.notFound') : undefined}
    >
      <Info_Page.Header title={project?.config.name ?? ''} />
      {project && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={<FolderKanban className="h-6 w-6 text-foreground/60" />}
            title={project.config.name}
            tagline={project.config.description ?? t('projectInfo.taglineFallback')}
          />

          <ProjectSettingsPanel
            name={editName}
            description={editDescription}
            storedWorkingDirectory={project.config.workingDirectory}
            workingDirectory={editWorkingDir}
            details={editDetails}
            historySearch={editHistorySearch}
            color={editColor}
            slug={project.config.slug}
            folderPath={project.folderPath}
            saving={saving}
            folderError={folderError}
            onNameChange={setEditName}
            onDescriptionChange={setEditDescription}
            onDetailsChange={setEditDetails}
            onHistorySearchChange={setEditHistorySearch}
            onColorChange={setEditColor}
            onPickFolder={pickDirectory}
            onSave={handleSaveSettings}
            onDelete={handleDeleteProject}
            onOpenLocation={() => onOpenFile(project.folderPath)}
            resources={(
              <SettingsSection
                title={t('projectInfo.tabAssets')}
                description={t('projectInfo.assetsHint')}
                action={(
                  <Button variant="outline" size="sm" asChild>
                    <label>
                      <Upload />
                      {t('projectInfo.uploadAssets')}
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        onChange={async (event) => {
                          const files = Array.from(event.target.files ?? [])
                          for (const file of files) await handleUpload(file)
                          event.target.value = ''
                        }}
                      />
                    </label>
                  </Button>
                )}
              >
                <SettingsCard divided={false}>
                  {assets.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('projectInfo.noAssets')}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/50">
                      {assets.map((asset) => (
                        <li key={asset.filename} className="flex items-center gap-3 px-4 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{asset.filename}</div>
                            <div className="text-xs text-foreground/50">
                              {(asset.sizeBytes / 1024).toFixed(1)} KB · {asset.mimeType}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteAsset(asset)}
                            className="text-destructive hover:text-destructive"
                            aria-label={t('projectInfo.deleteAssetConfirm', { name: asset.filename })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SettingsCard>
              </SettingsSection>
            )}
          />
          <ServerDirectoryBrowser
            open={showServerBrowser}
            mode={serverBrowserMode}
            onSelect={confirmServerBrowser}
            onCancel={cancelServerBrowser}
            initialPath={editWorkingDir || undefined}
          />
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
