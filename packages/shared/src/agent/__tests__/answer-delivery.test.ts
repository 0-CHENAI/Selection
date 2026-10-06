import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAgent } from '../pi-agent'
import type { AnswerDeliveryControl } from '../backend/types'
import { answerToolBlock } from '../answer-delivery'

const request = { requestId: 'req', toolName: 'mcp__session__submit_answer', args: { markdown: '完整答案。', featuredArtifacts: [] }, toolCallId: 'call', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-entry', answerRunId: 'run' }
describe('answer delivery execution bridge', () => {
  let root: string
  let agent: PiAgent
  let sent: any[]
  let submitted: any[]
  let control: AnswerDeliveryControl
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-answer-bridge-'))
    agent = new PiAgent({ provider: 'pi', isHeadless: true, explicitAnswerDelivery: true,
      workspace: { id: 'test', name: 'Test', rootPath: root } as any,
      session: { id: 'test-session', workspaceRootPath: root, createdAt: Date.now(), lastUsedAt: Date.now() } as any })
    sent = []; submitted = []
    ;(agent as any).send = (message: unknown) => sent.push(message)
    control = { runId: 'run', recovery: false, isActive: () => true, submit: async value => { submitted.push(value) } }
    agent.configureAnswerDelivery(control)
  })
  afterEach(() => { agent.destroy(); rmSync(root, { recursive: true, force: true }) })
  it('awaits host acceptance before returning a compact receipt', async () => {
    await (agent as any).handleToolExecuteRequest(request)
    expect(submitted).toEqual([{ markdown: request.args.markdown, artifactVersionTitle: undefined, toolCallId: 'call', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-entry' }])
    expect(sent.at(-1).result.isError).toBe(false)
    expect(JSON.stringify(sent.at(-1))).not.toContain(request.args.markdown)
    await (agent as any).handleToolExecuteRequest({ ...request, requestId: 'late', toolName: 'Bash', args: { command: 'echo forbidden' } })
    expect(sent.at(-1).result.isError).toBe(true)
    expect(submitted).toHaveLength(1)
  })
  it('blocks stale run requests at both permission and execution boundaries', async () => {
    await (agent as any).handleToolExecuteRequest({ ...request, answerRunId: 'old' })
    expect(sent.at(-1).result.isError).toBe(true)
    await (agent as any).handlePreToolUseRequest({ requestId: 'old', toolName: 'Bash', input: {}, answerRunId: 'old' })
    expect(sent.at(-1).action).toBe('block')
    expect(submitted).toHaveLength(0)
  })
  it('rejects invalid or model-supplied routing fields', async () => {
    for (const args of [{ markdown: ' | \n' }, { markdown: '答案', sessionId: 'other' }]) {
      await (agent as any).handleToolExecuteRequest({ ...request, args })
      expect(sent.at(-1).result.isError).toBe(true)
    }
    expect(submitted).toHaveLength(0)
  })
  it('does not fabricate success without the SDK anchor', async () => {
    await (agent as any).handleToolExecuteRequest({ ...request, sdkTurnAnchor: undefined })
    expect(sent.at(-1).result.isError).toBe(true)
    expect(submitted).toHaveLength(0)
  })
  it('returns server rejection as an error, allowing a corrected submission', async () => {
    control.submit = async () => { throw new Error('Swarm aggregation incomplete') }
    await (agent as any).handleToolExecuteRequest(request)
    expect(sent.at(-1).result.isError).toBe(true)
    expect(answerToolBlock(control, false, 'Bash', 'run')).toBeUndefined()
  })
  it('keeps internal coordination tools active without allowing final answer delivery', async () => {
    control.coordinationOnly = true
    expect(answerToolBlock(control, false, 'mcp__session__submit_orchestration_decision', 'run')).toBeUndefined()
    expect(answerToolBlock(control, false, 'submit_answer', 'run')).toContain('end the assistant turn')
    await (agent as any).handleToolExecuteRequest(request)
    expect(sent.at(-1).result.isError).toBe(true)
    expect(submitted).toHaveLength(0)
  })
  it('registers answer delivery for a restored canonical root even when boot configuration disabled it', () => {
    ;(agent as any).config.explicitAnswerDelivery = false
    ;(agent as any).config.session.taskSlug = 'existing-plan'
    ;(agent as any).registerSessionToolsWithSubprocess()
    const names = sent.at(-1).tools.map((tool: any) => tool.name)
    expect(names).toContain('mcp__session__submit_answer')
    expect(names).not.toContain('mcp__session__submit_task_output')
    expect(names).not.toContain('mcp__session__submit_task_node_verdict')
    expect((agent as any).registeredAnswerDelivery).toBe(true)
  })
  it('limits recovery to answer submission and fails closed after cancellation', () => {
    control.recovery = true
    expect(answerToolBlock(control, false, 'Bash', 'run')).toContain('Only submit_answer')
    expect(answerToolBlock(control, false, 'submit_answer', 'run')).toBeUndefined()
    control.isActive = () => false
    expect(answerToolBlock(control, false, 'submit_answer', 'run')).toContain('no longer active')
  })
  it('reads only its own live runtime context during recovery and rejects stale turns', async () => {
    control.recovery = true
    const routed: unknown[] = []
    ;(agent as any).routeToolCall = async (...args: unknown[]) => {
      routed.push(args)
      return { content: '{"orchestration":{"status":"running"}}', isError: false }
    }
    await (agent as any).handleRuntimeContextRequest({ requestId: 'context', answerRunId: 'run',
      toolName: 'Bash', args: { command: 'forbidden', sessionId: 'other' } })
    expect(routed).toEqual([['mcp__session__get_session_info', {}]])
    expect(sent.at(-1).result.isError).toBe(false)
    await (agent as any).handleRuntimeContextRequest({ requestId: 'old', answerRunId: 'old' })
    expect(sent.at(-1).result.isError).toBe(true)
    control.isActive = () => false
    await (agent as any).handleRuntimeContextRequest({ requestId: 'cancelled', answerRunId: 'run' })
    expect(sent.at(-1).result.isError).toBe(true)
    expect(routed).toHaveLength(1)
    expect(answerToolBlock({ ...control, isActive: () => true }, false, 'get_session_info', 'run')).toContain('Only submit_answer')
  })
})
