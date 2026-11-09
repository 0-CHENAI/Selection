/**
 * CopyResourcesFromWorkspaceDialog — Import sources/skills FROM another local workspace
 * into the current one (filesystem copy + credentials by default).
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { cn } from '@/lib/utils'
import type { Workspace, LoadedSource, ResourceImportMode } from '../../../shared/types'
import { resolveSkillTitle, resolveSourceTitle } from '@craft-agent/shared/display-titles'

export interface CopyResourcesFromWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  resourceType?: 'source' | 'skill'
  onCopyComplete?: () => void
}

export function CopyResourcesFromWorkspaceDialog({
  open,
  onOpenChange,
  workspaces,
  activeWorkspaceId,
  resourceType = 'source',
  onCopyComplete,
}: CopyResourcesFromWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'pick-workspace' | 'pick-resources'>('pick-workspace')
  const [fromWorkspaceId, setFromWorkspaceId] = useState<string | null>(null)
  const [sources, setSources] = useState<LoadedSource[]>([])
  const [skills, setSkills] = useState<Array<{ slug: string; name: string }>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingList, setLoadingList] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [mode, setMode] = useState<ResourceImportMode>('skip')
  const [includeCredentials, setIncludeCredentials] = useState(true)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  const sourceWorkspaces = useMemo(
    () => workspaces.filter(w => w.id !== activeWorkspaceId && !w.remoteServer),
    [workspaces, activeWorkspaceId],
  )

  useEffect(() => {
    if (!open) return
    setStep('pick-workspace')
    setFromWorkspaceId(null)
    setSources([])
    setSkills([])
    setSelected(new Set())
    setMode('skip')
    setIncludeCredentials(true)
    setIsCopying(false)
    setLoadingList(false)
  }, [open])

  const loadResources = useCallback(async (workspaceId: string) => {
    setLoadingList(true)
    setSelected(new Set())
    try {
      if (resourceType === 'source') {
        const list = await window.electronAPI.getSources(workspaceId)
        // Only real on-disk sources (folderPath present); skip any virtual/builtin entries
        setSources(list.filter(s => Boolean(s.folderPath) && Boolean(s.config?.slug)))
        setSkills([])
      } else {
        const list = await window.electronAPI.getSkills(workspaceId)
        const normalized = list
          .filter((s) => s.source === 'workspace')
          .map((s) => ({
            slug: s.slug,
            name: resolveSkillTitle(s),
          }))
          .filter((s) => s.slug)
        setSkills(normalized)
        setSources([])
      }
      setFromWorkspaceId(workspaceId)
      setStep('pick-resources')
    } catch (err) {
      toast.error(t('copyFromWorkspace.loadFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoadingList(false)
    }
  }, [resourceType, t])

  const resourceKindKey = resourceType === 'source' ? 'sources' : 'skills'

  const items = resourceType === 'source'
    ? sources.map(s => ({ id: s.config.slug, label: resolveSourceTitle(s) || s.config.slug, hint: s.config.slug }))
    : skills.map(s => ({ id: s.slug, label: s.name, hint: s.slug }))

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(items.map(i => i.id)))
  }

  const handleCopy = useCallback(async () => {
    if (!fromWorkspaceId || !activeWorkspaceId || selected.size === 0) return

    const fromName = workspaces.find(w => w.id === fromWorkspaceId)?.name ?? fromWorkspaceId
    setIsCopying(true)
    const toastId = toast.loading(t('copyFromWorkspace.copying', { from: fromName }))

    try {
      const ids = Array.from(selected)
      const result = await window.electronAPI.copyResourcesBetweenWorkspaces(
        fromWorkspaceId,
        activeWorkspaceId,
        {
          sources: resourceType === 'source' ? ids : undefined,
          skills: resourceType === 'skill' ? ids : undefined,
          mode,
          includeCredentials: resourceType === 'source' ? includeCredentials : false,
        },
      )

      const bucket = resourceType === 'source' ? result.sources : result.skills
      const imported = bucket.imported.length
      const skipped = bucket.skipped.length
      const failed = bucket.failed.length

      if (failed > 0 && imported === 0) {
        toast.error(t('copyFromWorkspace.failed'), {
          id: toastId,
          description: bucket.failed[0]?.error,
        })
        return // keep dialog open
      }

      if (imported > 0) {
        const description = failed > 0
          ? `${failed} failed`
          : skipped > 0
            ? `${skipped} skipped`
            : undefined
        toast.success(t('copyFromWorkspace.success', { count: imported }), {
          id: toastId,
          description,
        })
        onOpenChange(false)
        onCopyComplete?.()
      } else if (skipped > 0) {
        toast.info(t('copyFromWorkspace.allSkipped'), { id: toastId })
      } else {
        toast.warning(t('copyFromWorkspace.nothingCopied'), { id: toastId })
      }

      if (bucket.warnings?.length) {
        console.warn('[CopyFromWorkspace] warnings:', bucket.warnings)
      }
    } catch (err) {
      toast.error(t('copyFromWorkspace.failed'), {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsCopying(false)
    }
  }, [
    fromWorkspaceId,
    activeWorkspaceId,
    selected,
    workspaces,
    resourceType,
    mode,
    includeCredentials,
    onOpenChange,
    onCopyComplete,
    t,
  ])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isCopying) onOpenChange(isOpen)
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            {t('copyFromWorkspace.title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'pick-workspace'
              ? t(`copyFromWorkspace.pickWorkspaceDesc.${resourceKindKey}`)
              : t(`copyFromWorkspace.pickResourcesDesc.${resourceKindKey}`)}
          </DialogDescription>
        </DialogHeader>

        {step === 'pick-workspace' && (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto py-1">
            {sourceWorkspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                {t('copyFromWorkspace.noLocalWorkspaces')}
              </p>
            ) : (
              sourceWorkspaces.map(workspace => (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={loadingList}
                  onClick={() => loadResources(workspace.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <WorkspaceAvatar
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    src={workspaceIconMap.get(workspace.id)}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50 shrink-0"
                    fallbackClassName="rounded-full"
                  />
                  <span className="flex-1 truncate">{workspace.name}</span>
                  <Monitor className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              ))
            )}
          </div>
        )}

        {step === 'pick-resources' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep('pick-workspace')
                  setSelected(new Set())
                }}
                disabled={isCopying}
              >
                ← {t('copyFromWorkspace.back')}
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={selectAll}
                disabled={isCopying || items.length === 0}
              >
                {t('copyFromWorkspace.selectAll')}
              </button>
            </div>

            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto border border-border/50 rounded-md p-1">
              {loadingList ? (
                <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                  {t('common.loading')}
                </p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                  {t(`copyFromWorkspace.emptyList.${resourceKindKey}`)}
                </p>
              ) : (
                items.map(item => {
                  const checked = selected.has(item.id)
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer',
                        'hover:bg-foreground/5',
                        checked && 'bg-foreground/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isCopying}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {item.hint}
                      </span>
                    </label>
                  )
                })
              )}
            </div>

            <div className="flex flex-col gap-2 px-1 pt-1">
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={mode === 'overwrite'}
                  disabled={isCopying}
                  onChange={(e) => setMode(e.target.checked ? 'overwrite' : 'skip')}
                />
                <span>{t('sendResource.overwriteIfExists')}</span>
              </label>
              {resourceType === 'source' && (
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={includeCredentials}
                    disabled={isCopying}
                    onChange={(e) => setIncludeCredentials(e.target.checked)}
                  />
                  <span>{t('sendResource.includeCredentials')}</span>
                </label>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCopying}
          >
            {t('common.cancel')}
          </Button>
          {step === 'pick-resources' && (
            <Button
              onClick={handleCopy}
              disabled={selected.size === 0 || isCopying}
            >
              {isCopying
                ? t('copyFromWorkspace.copyingBtn')
                : t('copyFromWorkspace.copyBtn', { count: selected.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
