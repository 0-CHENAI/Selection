import { expect, it } from 'bun:test'
import { newThoughtDocument } from '@craft-agent/shared/thought-workbench/types'
import { workbenchEditorTarget } from '../orchestration-editor-target'

it('switches saved workbenches by task identity without reusing a previous runtime session', () => {
  expect(workbenchEditorTarget({ ...newThoughtDocument('draft'), taskSlug: 'second-task' })).toEqual({ mode: 'edit', taskSlug: 'second-task', sessionId: '' })
})
it('opens detached and imported workbenches as create targets in their own project', () => {
  expect(workbenchEditorTarget({ ...newThoughtDocument('draft'), projectId: 'project' })).toEqual({ mode: 'create', initialProjectId: 'project' })
})
