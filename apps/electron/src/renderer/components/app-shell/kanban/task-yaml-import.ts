import { isMap, parseDocument } from 'yaml'
import { MAX_TASK_IMPORT_BYTES } from '@craft-agent/shared/tasks/version'

/** Inherit the selected project only when YAML does not explicitly bind one. */
export function prepareTaskImport(yaml: string, projectId?: string): { yaml: string; projectId?: string } {
  if (new TextEncoder().encode(yaml).byteLength > MAX_TASK_IMPORT_BYTES) throw new Error('size')
  const document = parseDocument(yaml)
  if (document.errors.length) throw document.errors[0]
  if (!isMap(document.contents) || document.get('schema_version') !== 3) throw new Error('version')
  if (projectId && !document.has('project')) document.set('project', projectId)
  const project = document.get('project')
  return { yaml: document.toString(), projectId: typeof project === 'string' ? project : undefined }
}

/** Stable user-facing category; preserve original details for diagnosis. */
export function taskImportErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'size') return 'tasks.yamlImportFileError'
  if (message === 'version') return 'tasks.yamlImportVersionError'
  if (message.includes('A task with this id already exists')) return 'tasks.yamlImportDuplicate'
  return 'tasks.yamlImportFailed'
}
