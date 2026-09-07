import { expect, it } from 'bun:test'
import { parse } from 'yaml'
import { prepareTaskImport, taskImportErrorKey } from '../task-yaml-import'
import { MAX_TASK_IMPORT_BYTES } from '@craft-agent/shared/tasks/version'
import { isUnboundTaskEdit } from '../orchestration-editor-target'

const yaml = '# Keep this comment\nschema_version: 3\nid: demo\n'
it('rejects legacy unbound edit targets rather than creating a separate task', () => {
  expect(isUnboundTaskEdit({ mode: 'edit', sessionId: 'old' })).toBe(true)
  expect(isUnboundTaskEdit({ mode: 'edit', sessionId: 'bound', taskSlug: 'demo' })).toBe(false)
  expect(isUnboundTaskEdit({ mode: 'create' })).toBe(false)
})
it('inherits project scope while retaining explicit project and YAML comments', () => {
  const scoped = prepareTaskImport(yaml, 'selected')
  expect(scoped.projectId).toBe('selected')
  expect(parse(scoped.yaml).project).toBe('selected')
  expect(scoped.yaml).toContain('# Keep this comment')
  expect(prepareTaskImport(yaml + 'project: explicit\n', 'selected').projectId).toBe('explicit')
  expect(prepareTaskImport(yaml).projectId).toBeUndefined()
})
it('rejects pasted oversize UTF-8 text and invalid versions', () => {
  expect(() => prepareTaskImport(yaml + '# ' + '中'.repeat(MAX_TASK_IMPORT_BYTES / 2))).toThrow('size')
  expect(() => prepareTaskImport('schema_version: 2')).toThrow('version')
  expect(() => prepareTaskImport('schema_version: "3"')).toThrow('version')
  expect(() => prepareTaskImport('schema_version: 3\nschema_version: 2')).toThrow()
  expect(() => prepareTaskImport('plain text')).toThrow('version')
  expect(() => prepareTaskImport('[1, 2]')).toThrow('version')
})

it('categorizes errors for localized recovery without hiding unknown failures', () => {
  expect(taskImportErrorKey(new Error('A task with this id already exists.'))).toBe('tasks.yamlImportDuplicate')
  expect(taskImportErrorKey(new Error('network disconnected'))).toBe('tasks.yamlImportFailed')
  expect(taskImportErrorKey(new Error('size'))).toBe('tasks.yamlImportFileError')
})
