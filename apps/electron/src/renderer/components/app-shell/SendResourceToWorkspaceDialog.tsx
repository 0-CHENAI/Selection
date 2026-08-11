/**
 * SendResourceToWorkspaceDialog — Copy a source, skill, or automation to another workspace.
 *
 * Local targets:
 *   - sources/skills → resources:copyBetweenWorkspaces (filesystem + credentials by default)
 *   - automations → export → import (no credential store secrets)
 *
 * Remote targets:
 *   - export → import via invokeOnServer (credentials stripped; portable bundle)
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, CloudOff, Monitor, Send } from 'lucide-react'
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
import type { Workspace, ExportResourcesOptions, ResourceImportMode, ResourceImportResult } from '../../../shared/types'

export type SendResourceType = 'source' | 'skill' | 'automation'

export interface SendResourceToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: SendResourceType
  resourceIds: string[]
  resourceLabel: string
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onTransferComplete?: () => void
}

const RESOURCE_TYPE_LABELS: Record<SendResourceType, { singular: string; plural: string }> = {
  source: { singular: 'source', plural: 'sources' },
  skill: { singular: 'skill', plural: 'skills' },
  automation: { singular: 'automation', plural: 'automations' },
}

function bucketForType(result: ResourceImportResult, resourceType: SendResourceType) {
  if (resourceType === 'source') return result.sources
  if (resourceType === 'skill') return result.skills
  return result.automations
}

export function SendResourceToWorkspaceDialog({
  open,
  onOpenChange,
  resourceType,
  resourceIds,
  resourceLabel,
  workspaces,
  activeWorkspaceId,
  onTransferComplete,
}: SendResourceToWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [mode, setMode] = useState<ResourceImportMode>('skip')
  const [includeCredentials, setIncludeCredentials] = useState(true)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

  const targetWorkspaces = useMemo(
    () => workspaces.filter(w => w.id !== activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  )
  const targetIdsKey = useMemo(
    () => targetWorkspaces.map(w => w.id).join(','),
    [targetWorkspaces],
  )

  const selectedTarget = workspaces.find(w => w.id === selectedWorkspaceId)
  const selectedIsRemote = !!selectedTarget?.remoteServer
  const showCredentialToggle = resourceType === 'source' && !selectedIsRemote

  // Reset transient state each time the dialog opens
  useEffect(() => {
    if (!open) return
    setSelectedWorkspaceId(null)
    setMode('skip')
    setIncludeCredentials(true)
    setIsSending(false)
  }, [open])

  useEffect(() => {
    if (!open) {
      healthCheckAbort.current?.abort()
      return
    }

    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteTargets = targetWorkspaces.filter(w => w.remoteServer)
    if (remoteTargets.length === 0) {
      setRemoteHealthMap(new Map())
      return
    }

    setRemoteHealthMap(() => {
      const next = new Map<string, 'ok' | 'error' | 'checking'>()
      for (const ws of remoteTargets) next.set(ws.id, 'checking')
      return next
    })

    for (const ws of remoteTargets) {
      window.electronAPI.testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then(result => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, 'error'))
        })
    }

    return () => abort.abort()
  }, [open, targetIdsKey, targetWorkspaces])

  const handleSend = useCallback(async () => {
    if (!selectedWorkspaceId || !activeWorkspaceId || resourceIds.length === 0) return

    const targetWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!targetWorkspace) return

    setIsSending(true)
    const targetName = targetWorkspace.name
    const { singular, plural } = RESOURCE_TYPE_LABELS[resourceType]
    const count = resourceIds.length
    const label = count === 1 ? singular : plural

    const toastId = toast.loading(t('sendResource.sending', { label: resourceLabel, target: targetName }))

    try {
      let importResult: ResourceImportResult

      const isRemote = !!targetWorkspace.remoteServer
      const useLocalCopy = !isRemote && (resourceType === 'source' || resourceType === 'skill')

      if (useLocalCopy) {
        importResult = await window.electronAPI.copyResourcesBetweenWorkspaces(
          activeWorkspaceId,
          selectedWorkspaceId,
          {
            sources: resourceType === 'source' ? resourceIds : undefined,
            skills: resourceType === 'skill' ? resourceIds : undefined,
            mode,
            includeCredentials: resourceType === 'source' ? includeCredentials : false,
          },
        )
      } else {
        const exportOptions: ExportResourcesOptions = {}
        if (resourceType === 'source') exportOptions.sources = resourceIds
        else if (resourceType === 'skill') exportOptions.skills = resourceIds
        else if (resourceType === 'automation') exportOptions.automations = resourceIds

        const { bundle, warnings: exportWarnings } = await window.electronAPI.exportResources(
          activeWorkspaceId,
          exportOptions,
        )

        if (isRemote) {
          const { url, token, remoteWorkspaceId } = targetWorkspace.remoteServer!
          importResult = await window.electronAPI.invokeOnServer(
            url, token,
            'resources:import',
            remoteWorkspaceId, bundle, mode,
          )
        } else {
          importResult = await window.electronAPI.importResources(
            selectedWorkspaceId,
            bundle,
            mode,
          )
        }

        if (exportWarnings.length > 0) {
          console.warn('[SendResource] Export warnings:', exportWarnings)
        }
      }

      const bucket = bucketForType(importResult, resourceType)
      const imported = bucket?.imported?.length ?? 0
      const skipped = bucket?.skipped?.length ?? 0
      const failed = bucket?.failed?.length ?? 0
      const warnings = bucket?.warnings ?? []

      if (failed > 0 && imported === 0) {
        toast.error(t('sendResource.failed', { label }), {
          id: toastId,
          description: bucket.failed[0]?.error,
        })
        return // keep dialog open
      }

      if (imported > 0 && failed > 0) {
        toast.success(t('sendResource.sentPartial', { imported, label, skipped: skipped + failed }), { id: toastId })
      } else if (imported > 0 && skipped === 0) {
        toast.success(t('sendResource.sent', { label: resourceLabel, target: targetName }), { id: toastId })
      } else if (imported > 0 && skipped > 0) {
        toast.success(t('sendResource.sentPartial', { imported, label, skipped }), { id: toastId })
      } else if (skipped > 0) {
        toast.info(t('sendResource.alreadyExists', { label: resourceLabel, target: targetName }), { id: toastId })
      } else {
        toast.warning(t('sendResource.nothingSent', { target: targetName }), { id: toastId })
        return
      }

      if (warnings.length > 0) {
        console.warn('[SendResource] Import warnings:', warnings)
      }

      onOpenChange(false)
      onTransferComplete?.()
    } catch (error: any) {
      const isUnsupported = error?.code === 'CHANNEL_NOT_FOUND' ||
        (error?.message ?? '').includes('No handler for')
      const message = isUnsupported
        ? t('sendResource.remoteUnsupported', { target: targetName })
        : error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('sendResource.failed', { label }), { id: toastId, description: message })
    } finally {
      setIsSending(false)
    }
  }, [
    selectedWorkspaceId,
    activeWorkspaceId,
    resourceIds,
    resourceType,
    resourceLabel,
    workspaces,
    mode,
    includeCredentials,
    onOpenChange,
    onTransferComplete,
    t,
  ])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isSending) {
        onOpenChange(isOpen)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {t('sendResource.title')}
          </DialogTitle>
          <DialogDescription>
            {t('sendResource.description', { label: resourceLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto py-1">
          {targetWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">
              {t('sendResource.noOtherWorkspaces')}
            </p>
          ) : (
            targetWorkspaces.map(workspace => {
              const isSelected = selectedWorkspaceId === workspace.id
              const isRemote = !!workspace.remoteServer
              const healthStatus = remoteHealthMap.get(workspace.id)
              const isDisconnected = isRemote && healthStatus === 'error'
              const isChecking = isRemote && healthStatus === 'checking'

              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={isSending || isDisconnected}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-foreground/10 ring-1 ring-foreground/15',
                    isDisconnected && 'opacity-50 cursor-not-allowed hover:bg-transparent',
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
                  {isRemote ? (
                    isDisconnected ? (
                      <CloudOff className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    ) : (
                      <Cloud className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        isChecking ? 'text-muted-foreground/30 animate-pulse' : 'text-muted-foreground',
                      )} />
                    )
                  ) : (
                    <Monitor className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="flex flex-col gap-2 px-1 pt-1 border-t border-border/50">
          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={mode === 'overwrite'}
              disabled={isSending}
              onChange={(e) => setMode(e.target.checked ? 'overwrite' : 'skip')}
            />
            <span>{t('sendResource.overwriteIfExists')}</span>
          </label>
          {showCredentialToggle && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeCredentials}
                disabled={isSending}
                onChange={(e) => setIncludeCredentials(e.target.checked)}
              />
              <span>{t('sendResource.includeCredentials')}</span>
            </label>
          )}
          {selectedIsRemote && resourceType === 'source' && (
            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              {t('sendResource.remoteNoCredentials')}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedWorkspaceId || isSending}
          >
            {isSending ? t('sendResource.sendingBtn') : t('sendResource.sendBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
