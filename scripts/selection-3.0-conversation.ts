#!/usr/bin/env bun
/** #320: real safe-mode generator rounds through the same RPC handler as the editor. */
import assert from 'node:assert/strict'
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { registerTasksHandlers } from '../packages/server-core/src/handlers/rpc/tasks'
import { RPC_CHANNELS, type TaskGenerateRequest, type TaskGenerateResult, type TaskProposalTurn } from '@craft-agent/shared/protocol'
import type { RpcServer } from '../packages/server-core/src/transport'
import type { HandlerDeps } from '../packages/server-core/src/handlers/handler-deps'
import { serializeTaskYaml, parseTaskYaml, type TaskSpec } from '@craft-agent/shared/tasks'

const repo = resolve(import.meta.dir, '..')
const workspace = getWorkspaces()[0]!, connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!
assert(workspace && connection)
setBundledAssetsRoot(join(repo, 'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager(); manager.setEventSink(() => {})
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
let settle: ((result: TaskGenerateResult) => void) | undefined
registerTasksHandlers({ handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler), push: (_channel: string, _target: unknown, _workspace: string, result: TaskGenerateResult) => settle?.(result) } as unknown as RpcServer, { sessionManager: manager } as HandlerDeps)
const taskNames = () => existsSync(join(workspace.rootPath, 'tasks')) ? readdirSync(join(workspace.rootPath, 'tasks')).sort() : []
const before = taskNames(), conversation: TaskProposalTurn[] = [], results: TaskGenerateResult[] = []
async function generate(goal: string, currentYaml?: string) {
  const completion = new Promise<TaskGenerateResult>(resolve => { settle = resolve })
  const req: TaskGenerateRequest = { goal, currentYaml, conversation: structuredClone(conversation), model: connection.defaultModel, llmConnection: connection.slug }
  await handlers.get(RPC_CHANNELS.tasks.GENERATE)!({}, workspace.id, req)
  const result = await completion
  assert(!result.error && result.validation.valid && result.spec, JSON.stringify(result))
  results.push(result); conversation.push({ goal, yaml: result.yaml, status: 'applied' })
  return result.spec as TaskSpec
}
try {
  await manager.reinitializeAuth()
  let spec = await generate('创建只读资料研究工作流：id research-conversation。三个节点 id 分别为 collect（收集资料）、analyze（分析collect资料）、report（依据analyze输出英文报告）。collect→analyze→report，runner conduct，不执行实际任务。')
  assert.deepEqual(spec.nodes.map(n => n.id).sort(), ['analyze','collect','report'])
  const originalCollect = structuredClone(spec.nodes.find(n => n.id === 'collect'))
  spec = await generate('在 analyze 前插入 id dedup 的资料去重节点：collect→dedup→analyze→report。analyze 的输入引用从 collect 改成 dedup，其余节点及配置保持不变。', serializeTaskYaml(spec))
  assert.deepEqual(spec.nodes.find(n => n.id === 'collect'), originalCollect)
  assert(spec.nodes.find(n => n.id === 'analyze')!.depends_on?.includes('dedup'))
  const manual = spec.nodes.find(n => n.id === 'collect')!
  manual.model = 'gpt-6-sol'; manual.llmConnection = connection.slug; manual.timeout = 1234
  assert(parseTaskYaml(serializeTaskYaml(spec)).valid, "Manual draft must be valid before generation")
  const manuallyEdited = structuredClone(spec)
  spec = await generate('只将 report 节点的提示词改成中文输出报告，依据 analyze 成果。其他节点、配置、依赖一律保持当前草稿值，不要恢复历史提案。', serializeTaskYaml(spec))
  assert.deepEqual(spec.nodes.filter(n => n.id !== 'report'), manuallyEdited.nodes.filter(n => n.id !== 'report'))
  assert(spec.nodes.find(n => n.id === 'report')!.prompt!.includes('中文'))
  conversation.at(-1)!.status = 'discarded' // A rejected next round must not become the current draft.
  const preserved = structuredClone(spec.nodes.find(n => n.id === 'collect'))
  spec = await generate('删除 dedup 节点，让 analyze 直接依赖 collect，并引用 collect 输出；report 和 collect 及全部配置不变。', serializeTaskYaml(spec))
  assert(!spec.nodes.some(n => n.id === 'dedup'))
  assert.deepEqual(spec.nodes.find(n => n.id === 'collect'), preserved)
  assert(parseTaskYaml(serializeTaskYaml(spec)).valid)
  assert.deepEqual(taskNames(), before, 'Generation must never save or start a workflow')
  writeFileSync('/tmp/selection-version-3.0/320-conversation-real.json', JSON.stringify({ workspaceId: workspace.id, model: connection.defaultModel, connection: connection.slug, results, latestManualEditsPreserved: true, noTasksCreated: true }, null, 2))
  console.log(JSON.stringify({ rounds: results.length, latestManualEditsPreserved: true, noTasksCreated: true, nodeIds: spec.nodes.map(n => n.id) }))
} finally { await manager.flushAllSessions(); manager.cleanup() }
