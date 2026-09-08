import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TaskTemplateDetailDto, TaskTemplateSummaryDto } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import { filterTemplates, taskTemplateErrorKey } from './task-template-library'
import type { TaskEditorProps } from './TaskEditor'

function asWorkbenchSpec(spec: unknown): WorkbenchSpec | null {
  if (!spec || typeof spec !== 'object') return null
  const nodes = (spec as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return null
  return spec as WorkbenchSpec
}

export function TaskTemplateLibrary({
  workspaceId,
  projectId,
  initialId,
  onClose,
  onCreated,
}: Pick<TaskEditorProps, 'workspaceId' | 'onClose' | 'onCreated'> & {
  projectId?: string
  initialId?: string
}) {
  const { t, i18n } = useTranslation()
  const [templates, setTemplates] = React.useState<TaskTemplateSummaryDto[]>([])
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | undefined>(initialId)
  const [detail, setDetail] = React.useState<TaskTemplateDetailDto | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => () => { mounted.current = false }, [])

  const loadList = React.useCallback(async () => {
    const list = await window.electronAPI.listTaskTemplates(workspaceId)
    if (mounted.current) setTemplates(list)
  }, [workspaceId])

  React.useEffect(() => { void loadList().catch((err) => setError(taskTemplateErrorKey(err))) }, [loadList])

  React.useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    void window.electronAPI.getTaskTemplate(workspaceId, selectedId).then((next) => {
      if (!cancelled && mounted.current) setDetail(next)
    }).catch((err) => {
      if (!cancelled && mounted.current) setError(t(taskTemplateErrorKey(err)))
    })
    return () => { cancelled = true }
  }, [selectedId, workspaceId, t])

  const visible = filterTemplates(templates, query)
  const spec = detail ? asWorkbenchSpec(detail.spec) : null

  async function createFromSelectedTemplate() {
    if (!selectedId || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await window.electronAPI.createTaskFromTemplate(workspaceId, {
        templateId: selectedId,
        ...(projectId ? { projectId } : {}),
      })
      if (!created.validation.valid) {
        setError(created.validation.errors[0]?.message ?? t('tasks.templateInvalid'))
        return
      }
      toast.success(t('tasks.workflowCreated'))
      onCreated?.({ sessionId: created.orchestratorSessionId, taskLabelId: created.taskLabelId, projectId })
      onClose()
    } catch (err) {
      setError(t(taskTemplateErrorKey(err)))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function exportYaml() {
    if (!detail?.yaml) return
    try {
      await navigator.clipboard.writeText(detail.yaml)
      toast.success(t('tasks.templateExportCopied'))
    } catch {
      toast.error(t('tasks.templateInvalid'))
    }
  }

  async function removeTemplate() {
    if (!selectedId || busy) return
    if (!window.confirm(t('tasks.templateDeleteConfirm', { name: detail?.name ?? selectedId }))) return
    setBusy(true)
    try {
      await window.electronAPI.deleteTaskTemplate(workspaceId, selectedId)
      setSelectedId(undefined)
      setDetail(null)
      await loadList()
    } catch (err) {
      setError(t(taskTemplateErrorKey(err)))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (selectedId && detail && spec) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3 p-6" aria-label={t('tasks.templateLibrary')}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedId(undefined); setDetail(null) }}>{t('tasks.templateBack')}</Button>
          <h2 className="text-lg font-semibold">{detail.name}</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportYaml()}>{t('tasks.templateExport')}</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void removeTemplate()}>{t('tasks.templateDelete')}</Button>
            <Button size="sm" disabled={busy} onClick={() => void createFromSelectedTemplate()}>{t('tasks.templateUse')}</Button>
          </div>
        </div>
        {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="min-h-0 flex-1">
          <ConductorWorkbench spec={spec} />
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 p-6" aria-label={t('tasks.templateLibrary')}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t('tasks.templateLibrary')}</h2>
        <Button variant="ghost" className="ml-auto" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('tasks.templateHint')}</p>
      <input
        className="h-9 max-w-sm rounded-md border border-border bg-background px-3 text-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('tasks.templateSearch')}
        aria-label={t('tasks.templateSearch')}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.templateEmpty')}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 overflow-auto">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left hover:bg-foreground/[0.03]"
              onClick={() => setSelectedId(item.id)}
            >
              <span className="font-semibold">{item.name}</span>
              {item.description && <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{item.description}</span>}
              <span className="text-[11.5px] text-foreground/50">
                {t('tasks.templateNodeCount', { count: item.nodeCount })}
                {' · '}
                {t('tasks.templateUpdated', { date: new Date(item.updatedAt).toLocaleString(i18n.language) })}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
