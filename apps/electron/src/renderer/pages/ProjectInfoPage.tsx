import { confirmAction } from '@/lib/confirmation'
/**
 * ProjectInfoPage
 *
 * Workspace-project detail page with three tabs: Sessions, Assets, Settings.
 * v1 scope only — no memory tab, no provider selection, no plugin marketplace.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { FolderKanban, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { isOrdinarySessionVisible } from '@/lib/swarm-session'
import {
  Info_Page,
  Info_Section,
} from '@/components/info'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
import { mergeProjectSettingsRefresh, projectSettingsDraftDirty, projectSettingsDraftFromConfig } from '@/components/projects/project-settings-draft'
import { projectWorkingDirectorySaveIssue } from '@craft-agent/shared/projects/working-directory'
import type { LoadedProject, ProjectAsset } from '@craft-agent/shared/projects/types'

interface ProjectInfoPageProps {
  projectSlug: string
}

type TabKey = 'sessions' | 'assets' | 'settings'

export default function ProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { onCreateSession, onOpenFile } = useAppShellContext()

  const [project, setProject] = useState<LoadedProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('sessions')
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

  // Load assets when entering Assets tab
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
    if (tab === 'assets') refreshAssets()
  }, [tab, refreshAssets])

  const projectSessions = useMemo(() => {
    if (!project) return []
    const result: { id: string; name: string }[] = []
    for (const meta of sessionMetaMap.values()) {
      if (isOrdinarySessionVisible(meta) && meta.projectId === project.config.id) {
        result.push({ id: meta.id, name: meta.name ?? meta.id })
      }
    }
    return result
  }, [project, sessionMetaMap])

  const handleStartSession = useCallback(async () => {
    if (!workspaceId || !project) return
    try {
      const session = await onCreateSession(workspaceId, { projectId: project.config.id })
      if (session?.id) {
        navigate(routes.view.allSessions(session.id))
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to create session:', err)
      toast.error(t('projectInfo.newSessionFailed'))
    }
  }, [workspaceId, project, onCreateSession, t])

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

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border/50 px-2 mb-4">
            <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
              {t('projectInfo.tabSessions')}
            </TabButton>
            <TabButton active={tab === 'assets'} onClick={() => setTab('assets')}>
              {t('projectInfo.tabAssets')}
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('projectInfo.tabSettings')}
            </TabButton>
          </div>

          {/* Sessions tab */}
          {tab === 'sessions' && (
            <Info_Section
              title={t('projectInfo.tabSessions')}
              actions={
                <Button size="sm" variant="ghost" onClick={handleStartSession}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('projectInfo.newSessionButton', { name: project.config.name })}
                </Button>
              }
            >
              {projectSessions.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noSessions')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {projectSessions.map((s) => (
                    <li key={s.id} className="px-4 py-2">
                      <button
                        type="button"
                        className="text-sm text-foreground hover:underline text-left"
                        onClick={() => navigate(routes.view.allSessions(s.id))}
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {/* Assets tab */}
          {tab === 'assets' && (
            <Info_Section
              title={t('projectInfo.tabAssets')}
              actions={
                <label
                  className="inline-flex items-center gap-1 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('projectInfo.uploadAssets')}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? [])
                      for (const f of files) await handleUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              }
            >
              {assets.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noAssets')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {assets.map((a) => (
                    <li key={a.filename} className="px-4 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.filename}</div>
                        <div className="text-xs text-foreground/50">
                          {(a.sizeBytes / 1024).toFixed(1)} KB · {a.mimeType}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteAsset(a)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
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
            />
          )}
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-sm rounded-t-md border-b-2',
        active
          ? 'border-foreground/80 text-foreground'
          : 'border-transparent text-foreground/60 hover:text-foreground/80'
      )}
    >
      {children}
    </button>
  )
}

