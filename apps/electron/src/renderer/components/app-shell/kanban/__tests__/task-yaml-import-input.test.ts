import { expect, it } from 'bun:test'
import { parse } from 'yaml'
import { prepareTaskImport } from '../task-yaml-import'
import { MAX_TASK_IMPORT_BYTES } from '@craft-agent/shared/tasks/version'

const yaml = '# Keep this comment\nschema_version: 3\nid: demo\n'
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
})
