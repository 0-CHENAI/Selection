import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { MAX_TASK_IMPORT_BYTES } from '@craft-agent/shared/tasks/version'
import { kanbanEditorDirtyAtom } from '@/atoms/kanban'
import { prepareTaskImport, taskImportErrorKey } from './task-yaml-import'
import { TaskTemplateSaveDialog } from './TaskTemplateSave'
import { taskTemplateErrorKey } from './task-template-library'
import { toast } from 'sonner'
import type { TaskEditorProps } from './TaskEditor'

/** Optional YAML import. New tasks default to the form editor; existing tasks keep their versioned editor. */
export function TaskYamlImport({
  workspaceId,
  onClose,
  onCreated,
  target,
  onOpenLibrary,
}: Pick<TaskEditorProps, 'workspaceId' | 'onClose' | 'onCreated' | 'target'> & {
  onOpenLibrary?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [yaml, setYaml] = React.useState('')
  const setEditorDirty = useSetAtom(kanbanEditorDirtyAtom)
  const [errors, setErrors] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [templateSaveOpen, setTemplateSaveOpen] = React.useState(false)
  const [templateSaveError, setTemplateSaveError] = React.useState<string | null>(null)
  const [templateDefaultName, setTemplateDefaultName] = React.useState('')
  const submitting = React.useRef(false)
  const fileRead = React.useRef(0)
  const input = React.useRef<HTMLInputElement>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setEditorDirty(false)
    }
  }, [setEditorDirty])

  function updateYaml(value: string) {
    setYaml(value)
    setEditorDirty(value.trim().length > 0)
  }

  function closeEditor() {
    if (yaml.trim() && !window.confirm(t('tasks.discardUnsaved'))) return
    setEditorDirty(false)
    onClose()
  }

  async function loadFile(file?: File) {
    if (!file) return
    const read = ++fileRead.current
    setErrors([])
    if (!/\.ya?ml$/i.test(file.name) || file.size > MAX_TASK_IMPORT_BYTES) {
      setErrors([t('tasks.yamlImportFileError')])
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      if (mounted.current && read === fileRead.current) updateYaml(text)
    } catch (error) {
      if (mounted.current && read === fileRead.current) setErrors([t('tasks.yamlImportReadFailed'), String(error)])
    } finally {
      if (mounted.current && read === fileRead.current) setBusy(false)
    }
  }

  async function importTask() {
    if (submitting.current || busy) return
    submitting.current = true
    setBusy(true)
    setErrors([])
    try {
      const prepared = prepareTaskImport(yaml, target?.mode === 'create' ? target.initialProjectId : undefined)
      // CREATE owns validation, avoiding a second parse/RPC and a navigation race between calls.
      const result = await window.electronAPI.createTask(workspaceId, { yaml: prepared.yaml })
      if (!mounted.current) return
      if (!result.validation.valid) {
        setErrors([t('tasks.yamlImportInvalid'), ...result.validation.errors.map(error => `${error.path}: ${error.message}`)])
        return
      }
      if (result.validation.warnings.length) {
        toast.warning(t('tasks.yamlImportTitle'), { description: result.validation.warnings.map(warning => warning.message).join('\n') })
      }
      toast.success(t('tasks.yamlImportSuccess'))
      setEditorDirty(false)
      onClose()
      onCreated?.({
        sessionId: result.orchestratorSessionId,
        taskLabelId: result.taskLabelId,
        projectId: prepared.projectId,
      })
    } catch (error) {
      if (mounted.current) {
        const key = taskImportErrorKey(error)
        setErrors(key === 'tasks.yamlImportFailed'
          ? [t(key), error instanceof Error ? error.message : String(error)]
          : [t(key)])
      }
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function openTemplateSave() {
    setErrors([])
    setTemplateSaveError(null)
    try {
      const prepared = prepareTaskImport(yaml)
      const validation = await window.electronAPI.validateTask(workspaceId, prepared.yaml)
      if (!validation.valid) {
        setErrors([t('tasks.yamlImportInvalid'), ...validation.errors.map(error => `${error.path}: ${error.message}`)])
        return
      }
      const spec = validation.spec as { title?: string } | undefined
      setTemplateDefaultName(spec?.title?.trim() || t('tasks.templateLibrary'))
      setTemplateSaveOpen(true)
    } catch (error) {
      setErrors([t(taskImportErrorKey(error))])
    }
  }

  async function confirmTemplateSave(input: { name: string; description: string; tags: string[] }) {
    if (busy) return
    setBusy(true)
    setTemplateSaveError(null)
    try {
      const prepared = prepareTaskImport(yaml)
      const saved = await window.electronAPI.saveTaskTemplate(workspaceId, {
        name: input.name,
        description: input.description || undefined,
        tags: input.tags,
        yaml: prepared.yaml,
      })
      if (!saved.validation.valid) {
        setTemplateSaveError(saved.validation.errors[0]?.message ?? t('tasks.templateInvalid'))
        return
      }
      toast.success(t('tasks.templateSaveSuccess'))
      setEditorDirty(false)
      setTemplateSaveOpen(false)
      if (onOpenLibrary) onOpenLibrary(saved.id)
      else onClose()
    } catch (error) {
      setTemplateSaveError(t(taskTemplateErrorKey(error)))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 p-6" aria-label={t('tasks.yamlImportTitle')} aria-busy={busy}>
      <h2 className="text-lg font-semibold">{t('tasks.yamlImportTitle')}</h2>
      <p id="yaml-import-hint" className="text-sm text-muted-foreground">{t('tasks.yamlImportHint')}</p>
      <input ref={input} type="file" accept=".yaml,.yml" className="hidden" disabled={busy}
        aria-label={t('tasks.yamlImportChoose')}
        onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = '' }} />
      <button type="button" className="self-start rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        disabled={busy} onClick={() => input.current?.click()}>{t('tasks.yamlImportChoose')}</button>
      <textarea className="min-h-40 flex-1 resize-none rounded-md border bg-background p-3 font-mono text-sm"
        aria-label={t('tasks.tabYaml')} aria-describedby="yaml-import-hint" aria-invalid={errors.length > 0} spellCheck={false} disabled={busy} value={yaml}
        onChange={event => { updateYaml(event.target.value); setErrors([]) }} />
      {errors.length > 0 && <ul role="alert" className="max-h-40 overflow-auto break-words text-sm text-destructive">
        {errors.map((error, index) => <li key={index}>{error}</li>)}
      </ul>}
      <div className="flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={closeEditor}>{t('common.cancel')}</button>
        <button type="button" disabled={busy || !yaml.trim()} onClick={() => void openTemplateSave()}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50">
          {t('tasks.templateSaveToLibrary')}
        </button>
        <button type="button" disabled={busy || !yaml.trim()} onClick={() => void importTask()}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {t(busy ? 'tasks.yamlImportBusy' : 'tasks.yamlImportTitle')}
        </button>
      </div>
      <TaskTemplateSaveDialog
        open={templateSaveOpen}
        defaultName={templateDefaultName || t('tasks.templateLibrary')}
        busy={busy}
        error={templateSaveError ?? undefined}
        onClose={() => { if (!busy) setTemplateSaveOpen(false) }}
        onSubmit={(input) => void confirmTemplateSave(input)}
      />
    </section>
  )
}
