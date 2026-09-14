import { expect, it } from 'bun:test'
import { parse } from 'yaml'
import { renameWorkbenchExecution, workbenchExecutionTitle, workbenchExecutionProject } from '../workbench-title'

it('reads aliased scalar metadata without expanding recursive collections', () => {
  const yaml = 'name: &name Shared\ntitle: *name\nproject: *name\nextra: &cycle [*cycle]\n'
  expect(workbenchExecutionTitle(yaml, 'Old')).toBe('Shared')
  expect(workbenchExecutionProject(yaml, 'old-project')).toBe('Shared')
  expect(workbenchExecutionTitle('title: *missing', 'Old')).toBe('Old')
  expect(workbenchExecutionProject('items: &items [a]\nproject: *items', 'old-project')).toBe('old-project')
})

it('synchronizes project changes and removal without erasing metadata for malformed drafts', () => {
  expect(workbenchExecutionProject('project: next', 'old')).toBe('next')
  expect(workbenchExecutionProject('id: task', 'old')).toBeUndefined()
  for (const yaml of ['', 'project: [', 'project: 12', '- item']) {
    expect(workbenchExecutionProject(yaml, 'old')).toBe('old')
  }
})

it('uses the authored execution title for backups without rejecting incomplete drafts', () => {
  expect(workbenchExecutionTitle('title: Renamed', 'Draft')).toBe('Renamed')
  expect(workbenchExecutionTitle('title: ""', 'Draft')).toBe('')
  for (const yaml of ['', 'title: [', 'title: 12', '- item']) {
    expect(workbenchExecutionTitle(yaml, 'Draft')).toBe('Draft')
  }
})

it('renames the execution title without losing advanced fields, comments or aliases', () => {
  const yaml = '# Keep this note\nschema_version: 3\ntitle: Old\ndefaults: &defaults\n  model: example\nnodes:\n  - id: one\n    settings: *defaults\noutputs:\n  result: ${nodes.one.output}\n'
  const updated = renameWorkbenchExecution(yaml, '统一标题')
  expect(parse(updated)).toEqual({ ...parse(yaml), title: '统一标题' })
  expect(updated).toContain('# Keep this note')
  expect(updated).toContain('&defaults')
  expect(updated).toContain('*defaults')
  expect(yaml).toContain('title: Old')
})

it('rejects invalid definitions rather than replacing them with a title-only document', () => {
  for (const yaml of ['', '- node', 'title: [broken', 'title: one\ntitle: two']) {
    expect(() => renameWorkbenchExecution(yaml, 'New')).toThrow()
  }
})
