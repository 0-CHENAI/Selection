import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filterTemplates, taskTemplateErrorKey } from '../task-template-library'
import { nodeDefinitionRows } from '../ConductorWorkbench'

function saveDialogSource(): string {
  return readFileSync(join(import.meta.dir, '../TaskTemplateSave.tsx'), 'utf8')
}

it('filters template cards by name and maps conflict errors', () => {
  const cards = [
    { id: 'review', name: 'Code Review' },
    { id: 'docs', name: 'Write docs' },
  ]
  expect(filterTemplates(cards, 'review').map((item) => item.id)).toEqual(['review'])
  expect(filterTemplates(cards, '').map((item) => item.id)).toEqual(['review', 'docs'])
  expect(taskTemplateErrorKey(new Error('A template named "Review" already exists.'))).toBe('tasks.templateConflict')
  expect(taskTemplateErrorKey(new Error('YAML import requires explicit schema_version: 3.'))).toBe('tasks.templateVersionError')
})

it('exposes definition fields for template inspector without run state', () => {
  const rows = nodeDefinitionRows({
    id: 'gate',
    title: 'Approval gate',
    kind: 'approval',
    prompt: 'Check the draft',
    depends_on: ['draft'],
    permissionMode: 'ask',
    model: 'demo',
    outputs: [{ name: 'verdict' }],
    route: { default: 'draft' },
  })
  expect(rows.map((row) => row.value)).toEqual(expect.arrayContaining([
    'Approval gate',
    'draft',
    'ask',
    'demo',
    'verdict',
    expect.stringContaining('route'),
  ]))
})

it('keeps the editor, import page and library as parallel reuse entries', () => {
  const editor = readFileSync(join(import.meta.dir, '../TaskEditor.tsx'), 'utf8')
  const importer = readFileSync(join(import.meta.dir, '../TaskYamlImport.tsx'), 'utf8')
  const library = readFileSync(join(import.meta.dir, '../TaskTemplateLibrary.tsx'), 'utf8')
  expect(editor).toContain("useState<'editor' | 'import' | 'library'>('editor')")
  expect(editor).toContain("t('tasks.templateLibrary')")
  expect(editor).toContain("t('tasks.templateSave')")
  expect(editor).toContain('<TaskProposal')
  expect(importer).toContain("t('tasks.templateSaveToLibrary')")
  expect(importer).not.toContain('createAndRun')
  expect(library).toContain('<ConductorWorkbench spec={spec} />')
  expect(library).not.toContain('liveRun')
  expect(library).toContain('createTaskFromTemplate')
})

it('keeps save-as-template copy independent of create-and-run', () => {
  const source = saveDialogSource()
  expect(source).toContain("t('tasks.templateSave')")
  expect(source).toContain("t('tasks.templateSaveHint')")
  expect(source).not.toContain('saveAndRun')
  expect(source).not.toContain('createAndRun')
})
