import { isAlias, isMap, isScalar, parseDocument, type Document } from 'yaml'

function stringMetadata(document: Document, key: string): string | undefined {
  const node = document.get(key, true)
  // Resolve only this scalar, never expand the entire graph or recursive aliases.
  const value = isAlias(node) ? node.resolve(document) : node
  return isScalar(value) && typeof value.value === 'string' ? value.value : undefined
}

/** Absence in a valid definition means no project; malformed drafts keep metadata. */
export function workbenchExecutionProject(yaml: string, fallback?: string): string | undefined {
  const document = parseDocument(yaml)
  if (document.errors.length || !isMap(document.contents)) return fallback
  if (!document.has('project')) return undefined
  return stringMetadata(document, 'project') ?? fallback
}

/** Draft backups may contain incomplete YAML; never discard them to extract metadata. */
export function workbenchExecutionTitle(yaml: string, fallback: string): string {
  const document = parseDocument(yaml)
  if (document.errors.length || !isMap(document.contents)) return fallback
  return stringMetadata(document, 'title') ?? fallback
}

/** Change only the title; preserve unknown fields, comments and YAML aliases. */
export function renameWorkbenchExecution(yaml: string, title: string): string {
  const document = parseDocument(yaml)
  if (document.errors.length) throw document.errors[0]
  if (!isMap(document.contents)) throw new Error('Execution definition must be a YAML mapping')
  document.set('title', title)
  return document.toString()
}
