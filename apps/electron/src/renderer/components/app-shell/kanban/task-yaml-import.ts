import { parseDocument } from 'yaml'
import { MAX_TASK_IMPORT_BYTES } from '@craft-agent/shared/tasks/version'

/** Inherit the selected project only when YAML does not explicitly bind one. */
export function prepareTaskImport(yaml: string, projectId?: string): { yaml: string; projectId?: string } {
  if (new TextEncoder().encode(yaml).byteLength > MAX_TASK_IMPORT_BYTES) throw new Error('size')
  const document = parseDocument(yaml)
  if (document.errors.length) throw document.errors[0]
  if (document.get('schema_version') !== 3) throw new Error('version')
  if (projectId && !document.has('project')) document.set('project', projectId)
  const project = document.get('project')
  return { yaml: document.toString(), projectId: typeof project === 'string' ? project : undefined }
}
