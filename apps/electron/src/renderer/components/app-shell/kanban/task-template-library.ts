import type { TaskTemplateSummaryDto } from '@craft-agent/shared/protocol'

export function filterTemplates<T extends Pick<TaskTemplateSummaryDto, 'name'>>(list: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return needle ? list.filter((item) => item.name.toLowerCase().includes(needle)) : list
}

export function taskTemplateErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('already exists')) return 'tasks.templateConflict'
  if (message.includes('schema_version: 3') || message.includes('YAML import requires')) return 'tasks.templateVersionError'
  return 'tasks.templateInvalid'
}
