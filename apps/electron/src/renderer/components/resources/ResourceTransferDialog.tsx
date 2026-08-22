import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Upload, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseAutomationsConfig, APP_EVENTS } from '@/components/automations/types'
import { resolveSkillTitle, resolveSourceTitle } from '@craft-agent/shared/display-titles'
import type {
  ResourceBundle,
  ResourceImportAction,
  ResourceImportDecision,
  ResourceImportPreview,
  ResourceImportResult,
  ResourceType,
} from '../../../shared/types'

type TransferMode = 'export' | 'import'
type ExportStep = 'select' | 'confirm'

interface SelectableResource {
  type: ResourceType
  id: string
  name: string
  group: string
}

interface ResourceTransferDialogProps {
  open: boolean
  mode: TransferMode
  workspaceId: string
  workspaceName?: string
  initialSelection?: Array<{ type: ResourceType; id: string }>
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

const keyFor = (type: ResourceType, id: string) => `${type}:${id}`

function summarizeResult(result: ResourceImportResult) {
  const buckets = [result.sources, result.skills, result.automations]
  return {
    imported: buckets.reduce((sum, item) => sum + item.imported.length, 0),
    skipped: buckets.reduce((sum, item) => sum + item.skipped.length, 0),
    failed: buckets.reduce((sum, item) => sum + item.failed.length, 0),
    failures: buckets.flatMap(item => item.failed),
    warnings: buckets.flatMap(item => item.warnings),
  }
}

function isValidRename(type: ResourceType, value: string) {
  if (!value.trim()) return false
  return type === 'automation'
    ? /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)
    : /^[a-z0-9][a-z0-9._-]*$/.test(value)
}

export function ResourceTransferDialog({
  open,
  mode,
  workspaceId,
  workspaceName,
  initialSelection,
  onOpenChange,
  onComplete,
}: ResourceTransferDialogProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [exportStep, setExportStep] = useState<ExportStep>('select')
  const [items, setItems] = useState<SelectableResource[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bundle, setBundle] = useState<ResourceBundle | null>(null)
  const [exportWarnings, setExportWarnings] = useState<string[]>([])
  const [fileName, setFileName] = useState<string>()
  const [preview, setPreview] = useState<ResourceImportPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, ResourceImportDecision>>({})
  const [result, setResult] = useState<ResourceImportResult | null>(null)
  const initialSelectionSignature = initialSelection?.map(item => keyFor(item.type, item.id)).join('|') ?? ''

  const close = useCallback(() => {
    if (!loading) onOpenChange(false)
  }, [loading, onOpenChange])

  const loadExportResources = useCallback(async () => {
    setLoading(true)
    try {
      const [sources, skills, rawAutomations] = await Promise.all([
        window.electronAPI.getSources(workspaceId),
        window.electronAPI.getSkills(workspaceId),
        window.electronAPI.getAutomations(workspaceId),
      ])
      const automations = parseAutomationsConfig(rawAutomations)
      const next: SelectableResource[] = [
        ...sources
          .filter(source => Boolean(source.folderPath) && Boolean(source.config?.slug))
          .map(source => ({
            type: 'source' as const,
            id: source.config.slug,
            name: resolveSourceTitle(source) || source.config.slug,
            group: t('resourceTransfer.groups.sources'),
          })),
        ...skills
          .filter(skill => skill.source === 'workspace')
          .map(skill => ({
            type: 'skill' as const,
            id: skill.slug,
            name: resolveSkillTitle(skill),
            group: t('resourceTransfer.groups.skills'),
          })),
        ...automations.map(automation => ({
          type: 'automation' as const,
          id: automation.id,
          name: automation.name,
          group: automation.event === 'SchedulerTick'
            ? t('resourceTransfer.groups.scheduled')
            : APP_EVENTS.includes(automation.event as never)
              ? t('resourceTransfer.groups.appEvents')
              : t('resourceTransfer.groups.agentEvents'),
        })),
      ]
      setItems(next)
      const initialKeys = initialSelectionSignature
        ? new Set(initialSelectionSignature.split('|'))
        : new Set(next.map(item => keyFor(item.type, item.id)))
      setSelected(initialKeys)
    } catch (error) {
      toast.error(t('resourceTransfer.loadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [initialSelectionSignature, onOpenChange, t, workspaceId])

  const chooseImportFile = useCallback(async () => {
    setLoading(true)
    try {
      const picked = await window.electronAPI.openResourceBundleFile()
      if (picked.canceled || !picked.bundle) {
        onOpenChange(false)
        return
      }
      setBundle(picked.bundle)
      setFileName(picked.fileName)
      const nextPreview = await window.electronAPI.previewResourceImport(workspaceId, picked.bundle)
      setPreview(nextPreview)
      const initial: Record<string, ResourceImportDecision> = {}
      for (const item of nextPreview.items) {
        initial[keyFor(item.type, item.id)] = {
          type: item.type,
          id: item.id,
          action: item.status === 'new' ? 'overwrite' : 'skip',
          expectedStatus: item.status,
          expectedTargetFingerprint: item.targetFingerprint,
          newId: item.suggestedId,
          enableAfterImport: false,
        }
      }
      setDecisions(initial)
    } catch (error) {
      toast.error(t('resourceTransfer.importReadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [onOpenChange, t, workspaceId])

  useEffect(() => {
    if (!open) return
    setExportStep('select')
    setItems([])
    setSelected(new Set())
    setBundle(null)
    setExportWarnings([])
    setFileName(undefined)
    setPreview(null)
    setDecisions({})
    setResult(null)
    if (mode === 'export') void loadExportResources()
    else void chooseImportFile()
  }, [chooseImportFile, loadExportResources, mode, open])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, SelectableResource[]>()
    for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item])
    return [...groups.entries()]
  }, [items])

  const prepareExport = async () => {
    setLoading(true)
    try {
      const selectedItems = items.filter(item => selected.has(keyFor(item.type, item.id)))
      const exported = await window.electronAPI.exportResources(workspaceId, {
        sources: selectedItems.filter(item => item.type === 'source').map(item => item.id),
        skills: selectedItems.filter(item => item.type === 'skill').map(item => item.id),
        automations: selectedItems.filter(item => item.type === 'automation').map(item => item.id),
        includeDependencies: true,
      })
      setBundle(exported.bundle)
      setExportWarnings(exported.warnings)
      setExportStep('confirm')
    } catch (error) {
      toast.error(t('resourceTransfer.exportFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const saveExport = async () => {
    if (!bundle) return
    setLoading(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      const saved = await window.electronAPI.saveResourceBundleFile(
        bundle,
        `selection-resources-${date}.selection-resources.json`,
      )
      if (saved.canceled) return
      toast.success(t('resourceTransfer.exportSuccess'), { description: saved.filePath })
      onOpenChange(false)
    } catch (error) {
      toast.error(t('resourceTransfer.exportFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const updateDecision = (type: ResourceType, id: string, patch: Partial<ResourceImportDecision>) => {
    const key = keyFor(type, id)
    setDecisions(current => ({ ...current, [key]: { ...current[key]!, ...patch } }))
  }

  const applyConflictAction = (action: ResourceImportAction) => {
    if (!preview) return
    setDecisions(current => {
      const next = { ...current }
      for (const item of preview.items) {
        if (item.status === 'new') continue
        if (action === 'overwrite' && item.status !== 'identity-conflict') continue
        const key = keyFor(item.type, item.id)
        next[key] = {
          ...next[key]!,
          action,
          newId: action === 'rename' ? (next[key]?.newId || item.suggestedId) : next[key]?.newId,
        }
      }
      return next
    })
  }

  const invalidDecision = preview?.items.some(item => {
    const decision = decisions[keyFor(item.type, item.id)]
    return !decision || (decision.action === 'rename' && !isValidRename(item.type, decision.newId ?? ''))
  }) ?? true

  const runImport = async () => {
    if (!bundle || !preview || !preview.valid || invalidDecision) return
    setLoading(true)
    try {
      const imported = await window.electronAPI.importResources(workspaceId, bundle, {
        decisions: preview.items.map(item => decisions[keyFor(item.type, item.id)]!),
      })
      setResult(imported)
      const totals = summarizeResult(imported)
      if (totals.failed > 0) toast.warning(t('resourceTransfer.importPartial'))
      else toast.success(t('resourceTransfer.importSuccess', { count: totals.imported }))
      onComplete?.()
    } catch (error) {
      toast.error(t('resourceTransfer.importFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const manifest = bundle?.manifest
  const autoAdded = manifest?.items.filter(item => item.autoAdded) ?? []
  const externalDependencies = manifest?.dependencies.filter(item => item.external) ?? []
  const totals = result ? summarizeResult(result) : null

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) close() }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'export' ? <Download className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {t(mode === 'export' ? 'resourceTransfer.exportTitle' : 'resourceTransfer.importTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'export'
              ? t('resourceTransfer.exportDescription', { workspace: workspaceName ?? workspaceId })
              : fileName ?? t('resourceTransfer.importDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
          {loading && !bundle && <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>}

          {mode === 'export' && exportStep === 'select' && !loading && (
            <div className="space-y-4">
              <div className="flex justify-end gap-3 text-xs">
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set(items.map(item => keyFor(item.type, item.id))))}>{t('resourceTransfer.selectAll')}</button>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>{t('resourceTransfer.clearAll')}</button>
              </div>
              {groupedItems.map(([group, groupItems]) => (
                <section key={group} className="space-y-1">
                  <h3 className="px-1 text-xs font-medium text-muted-foreground">{group}</h3>
                  <div className="rounded-lg border border-border/60 divide-y divide-border/50">
                    {groupItems.map(item => {
                      const key = keyFor(item.type, item.id)
                      return (
                        <label key={key} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-foreground/[0.02]">
                          <input type="checkbox" checked={selected.has(key)} onChange={() => setSelected(current => {
                            const next = new Set(current)
                            if (next.has(key)) next.delete(key); else next.add(key)
                            return next
                          })} />
                          <span className="min-w-0 flex-1 text-sm truncate">{item.name}</span>
                          <span className="text-xs text-muted-foreground truncate">{item.id}</span>
                        </label>
                      )
                    })}
                  </div>
                </section>
              ))}
              {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t('resourceTransfer.empty')}</p>}
            </div>
          )}

          {mode === 'export' && exportStep === 'confirm' && bundle && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-xs text-muted-foreground">{t('resourceTransfer.selected')}</div><div className="text-lg font-medium">{manifest?.items.filter(item => item.selected).length ?? 0}</div></div>
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-xs text-muted-foreground">{t('resourceTransfer.autoAdded')}</div><div className="text-lg font-medium">{autoAdded.length}</div></div>
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-xs text-muted-foreground">{t('resourceTransfer.redacted')}</div><div className="text-lg font-medium">{manifest?.redactions.length ?? 0}</div></div>
              </div>
              {autoAdded.length > 0 && <div><h3 className="font-medium">{t('resourceTransfer.autoAddedDependencies')}</h3><p className="mt-1 text-muted-foreground">{autoAdded.map(item => `${item.type}: ${item.name ?? item.id}`).join(', ')}</p></div>}
              {externalDependencies.length > 0 && <div><h3 className="font-medium">{t('resourceTransfer.externalDependencies')}</h3><p className="mt-1 text-muted-foreground">{externalDependencies.map(item => `${item.to.type}: ${item.to.id}`).join(', ')}</p></div>}
              {(exportWarnings.length > 0 || (manifest?.redactions.length ?? 0) > 0) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4" />{t('resourceTransfer.securityReview')}</div>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    {exportWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
                    {manifest?.redactions.map((redaction, index) => <li key={`r-${index}`}>{redaction.resource.type} {redaction.resource.id}: {redaction.path}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {mode === 'import' && preview && !result && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground">
                <span>{t('resourceTransfer.bundleVersion', { version: preview.version ?? '?' })}</span>
                <span>{t(preview.integrityVerified ? 'resourceTransfer.integrityVerified' : 'resourceTransfer.integrityUnavailable')}</span>
                <span>{t(preview.valid ? 'resourceTransfer.securityPassed' : 'resourceTransfer.securityFailed')}</span>
              </div>
              {!preview.valid && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{preview.errors.join('; ')}</div>}
              {preview.warnings.length > 0 && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">{preview.warnings.join(' · ')}</div>}
              {preview.valid && preview.items.some(item => item.status !== 'new') && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground mr-auto">{t('resourceTransfer.applyConflicts')}</span>
                  <Button size="sm" variant="outline" onClick={() => applyConflictAction('skip')}>{t('resourceTransfer.actions.skip')}</Button>
                  <Button size="sm" variant="outline" onClick={() => applyConflictAction('overwrite')}>{t('resourceTransfer.actions.overwriteIds')}</Button>
                  <Button size="sm" variant="outline" onClick={() => applyConflictAction('rename')}>{t('resourceTransfer.actions.rename')}</Button>
                </div>
              )}
              {preview.items.map(item => {
                const key = keyFor(item.type, item.id)
                const decision = decisions[key]
                const canEnable = !item.highRisk && !item.needsConfiguration && item.missingDependencies.length === 0
                const itemNotices = [
                  ...item.warnings,
                  ...item.missingDependencies.map(dep => `${t('resourceTransfer.missing')}: ${dep.type} ${dep.id}`),
                  ...(item.needsConfiguration ? [t('resourceTransfer.requiresConfiguration')] : []),
                  ...(item.highRisk ? [t('resourceTransfer.highRisk')] : []),
                ]
                return (
                  <div key={key} className={cn('rounded-lg border p-3 space-y-2', item.highRisk && 'border-amber-500/40')}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{item.name ?? item.id}</div><div className="text-xs text-muted-foreground">{item.type} · {item.id} · {t(`resourceTransfer.status.${item.status}`)}</div></div>
                      <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={decision?.action ?? 'skip'} onChange={event => updateDecision(item.type, item.id, { action: event.target.value as ResourceImportAction })}>
                        <option value="skip">{t('resourceTransfer.actions.skip')}</option>
                        {item.status !== 'name-conflict' && <option value="overwrite">{t(item.status === 'new' ? 'resourceTransfer.actions.import' : 'resourceTransfer.actions.overwrite')}</option>}
                        <option value="rename">{t('resourceTransfer.actions.rename')}</option>
                      </select>
                    </div>
                    {decision?.action === 'rename' && (
                      <div className={cn('grid gap-2', item.type === 'automation' && 'grid-cols-2')}>
                        <input className={cn('w-full h-8 rounded-md border bg-background px-2 text-sm', !isValidRename(item.type, decision.newId ?? '') && 'border-destructive')} value={decision.newId ?? ''} onChange={event => updateDecision(item.type, item.id, { newId: event.target.value })} placeholder={item.suggestedId} />
                        {item.type === 'automation' && <input className="w-full h-8 rounded-md border bg-background px-2 text-sm" value={decision.newName ?? item.name ?? ''} onChange={event => updateDecision(item.type, item.id, { newName: event.target.value })} placeholder={t('common.name')} />}
                      </div>
                    )}
                    {itemNotices.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{itemNotices.join(' · ')}</p>}
                    {item.type === 'automation' && (
                      <label className={cn('flex items-center gap-2 text-xs', !canEnable && 'text-muted-foreground')} title={!canEnable ? t('resourceTransfer.enableBlocked') : undefined}>
                        <input type="checkbox" disabled={!canEnable || decision?.action === 'skip'} checked={decision?.enableAfterImport === true} onChange={event => updateDecision(item.type, item.id, { enableAfterImport: event.target.checked })} />
                        {t('resourceTransfer.enableAfterImport')}
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {mode === 'import' && result && totals && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-2xl font-medium">{totals.imported}</div><div className="text-xs text-muted-foreground">{t('resourceTransfer.result.imported')}</div></div>
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-2xl font-medium">{totals.skipped}</div><div className="text-xs text-muted-foreground">{t('resourceTransfer.result.skipped')}</div></div>
                <div className="rounded-lg bg-foreground/[0.03] p-3"><div className="text-2xl font-medium">{totals.failed}</div><div className="text-xs text-muted-foreground">{t('resourceTransfer.result.failed')}</div></div>
              </div>
              {(totals.failures.length > 0 || totals.warnings.length > 0) && <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground space-y-1">{totals.failures.map(item => <p key={item.id}>{item.id}: {item.error}</p>)}{totals.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
              <p className="text-sm text-muted-foreground">{t('resourceTransfer.postImportNotice')}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={loading}>{result ? t('common.done') : t('common.cancel')}</Button>
          {mode === 'export' && exportStep === 'select' && <Button onClick={prepareExport} disabled={loading || selected.size === 0}>{t('common.continue')}</Button>}
          {mode === 'export' && exportStep === 'confirm' && <><Button variant="outline" onClick={() => setExportStep('select')} disabled={loading}>{t('common.back')}</Button><Button onClick={saveExport} disabled={loading}>{t('resourceTransfer.chooseSaveLocation')}</Button></>}
          {mode === 'import' && preview && !result && <Button onClick={runImport} disabled={loading || !preview.valid || invalidDecision}>{t('resourceTransfer.importAction')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
