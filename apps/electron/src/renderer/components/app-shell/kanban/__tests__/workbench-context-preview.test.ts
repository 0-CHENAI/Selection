import { expect, test } from 'bun:test'
import { compileThoughtContext } from '@craft-agent/shared/thought-workbench/context'
import { newThoughtDocument, newThoughtNode } from '@craft-agent/shared/thought-workbench/types'
import { workbenchContextPreview } from '../workbench-context-preview'

test('shows complete Agent text, tools, model and hash without duplicating binary attachment bytes', async () => {
  const context = await compileThoughtContext({ ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('q'), question: 'graph', mode: 'agent' }] }, 'q')
  context.agentInput = { hash: 'snapshot-hash', model: { id: 'selected-model', api: 'api', provider: 'provider', contextWindow: 8192 },
    context: { systemPrompt: 'platform-and-project', messages: [{ role: 'user', timestamp: 0, content: [{ type: 'text', text: 'exact graph text' }, { type: 'image', mimeType: 'image/png', data: 'private-binary-content' }] }], tools: [] } }
  const output = workbenchContextPreview(context)
  for (const text of ['platform-and-project', 'exact graph text', 'selected-model', 'snapshot-hash', '[tools]', 'image/png']) expect(output).toContain(text)
  expect(output).not.toContain('private-binary-content')
  expect(context.agentInput.context.messages[0]?.content).toEqual([{ type: 'text', text: 'exact graph text' }, { type: 'image', mimeType: 'image/png', data: 'private-binary-content' }])
})
