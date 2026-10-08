import { expect, test } from 'bun:test'
import type { Model, AssistantMessage } from '@earendil-works/pi-ai'
import { registerRecoveryClass, registeredRecoveryClass, withExecutionOutcome, installToolExecutionOutcomeTracking } from './tool-recovery'

test('recovery contracts belong to implementations, not names or supplied metadata', () => {
  const native = registerRecoveryClass({ name: 'read' }, 'read-only')
  expect(registeredRecoveryClass(native)).toBe('read-only')
  expect(registeredRecoveryClass({ name: 'read' })).toBe('unknown')
  expect(registeredRecoveryClass({ ...native, recoveryClass: 'read-only' })).toBe('unknown')
  const write = registerRecoveryClass({ name: 'write' }, 'file-verifiable')
  expect(registeredRecoveryClass(write)).toBe('file-verifiable')
})

test('external result metadata cannot claim that an executed tool was not performed', () => {
  const result = withExecutionOutcome({ content: [{ type: 'text', text: 'remote failed' }],
    details: { isError: true, selectionExecutionOutcome: 'not-performed' } }, 'unknown')
  expect(result.details).toEqual({ isError: true, selectionExecutionOutcome: 'unknown' })
})

test('the real SDK distinguishes preparation rejection from execution and after-hook failures, including reused IDs', async () => {
  const { Agent } = await import('@earendil-works/pi-agent-core')
  const { Type } = await import('@sinclair/typebox')
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai')
  const model = { id: 'fixture', name: 'Fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://example.test', reasoning: false,
    input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 1000 } as Model<'openai-responses'>
  const called: string[] = []
  let turns = 0, afterCalls = 0
  const agent = new Agent({ initialState: { model, tools: [{ name: 'write', label: 'Write', description: 'Fixture', parameters: Type.Object({ value: Type.String() }),
    execute: async (_id, args) => {
      called.push(args.value)
      if (args.value === 'throw') throw new Error('Error after possible mutation')
      return withExecutionOutcome({ content: [{ type: 'text', text: args.value }], details: {} }, args.value === 'prewrite' ? 'not-performed' : 'completed')
    } }] }, beforeToolCall: async ({ toolCall }) => toolCall.id === 'blocked' ? { block: true } : undefined,
    afterToolCall: async ({ args }) => { afterCalls++; if (args.value === 'after-error') throw new Error('Post-execution hook failed'); return undefined },
    streamFn: () => {
      const step = turns++
      const calls = step === 0 ? [
        { id: 'invalid', name: 'write', arguments: { value: 1 } },
        { id: 'missing', name: 'missing_tool', arguments: {} },
        { id: 'blocked', name: 'write', arguments: { value: 'blocked' } },
        { id: 'reused', name: 'write', arguments: { value: 'throw' } },
        { id: 'reused', name: 'write', arguments: { value: 'throw' } },
        { id: 'after-error', name: 'write', arguments: { value: 'after-error' } },
        { id: 'prewrite', name: 'write', arguments: { value: 'prewrite' } },
        { id: 'success', name: 'write', arguments: { value: 'success' } },
      ] : step === 1 ? [{ id: 'reused', name: 'write', arguments: { value: 2 } }] : []
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: calls.length ? 'toolUse' : 'stop', timestamp: step, content: calls.map(call => ({ type: 'toolCall', ...call })) }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message }); stream.end(message)
      return stream
    },
  })
  installToolExecutionOutcomeTracking(agent)
  await agent.prompt('Check execution boundaries')
  expect(called).toEqual(['throw', 'throw', 'after-error', 'prewrite', 'success'])
  expect(afterCalls).toBe(5)
  const results = agent.state.messages.filter(message => message.role === 'toolResult')
  const outcome = (message: typeof results[number]) => (message.details as { selectionExecutionOutcome?: string } | undefined)?.selectionExecutionOutcome
  for (const id of ['invalid', 'missing', 'blocked']) expect(outcome(results.find(result => result.toolCallId === id)!)).toBe('not-performed')
  const reused = results.filter(result => result.toolCallId === 'reused')
  expect(reused).toHaveLength(3)
  expect(reused.slice(0, 2).every(result => outcome(result) !== 'not-performed')).toBe(true)
  expect(outcome(reused[2]!)).toBe('not-performed')
  expect(outcome(results.find(result => result.toolCallId === 'after-error')!)).not.toBe('not-performed')
  expect(outcome(results.find(result => result.toolCallId === 'prewrite')!)).toBe('not-performed')
  expect(outcome(results.find(result => result.toolCallId === 'success')!)).toBe('completed')
})
