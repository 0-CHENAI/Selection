#!/usr/bin/env bun
/** Exercise the ordinary installed Electron host through the same chat RPC as its renderer. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { WsRpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { readRunLog } from '@craft-agent/shared/tasks'

const directory = process.argv[2]
assert(directory, 'Pass the isolated package QA configuration directory')
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
const workspace = config.workspaces[0]
// Usage: <isolated-config> [existing-session|-] [configured-connection]
const connection = config.llmConnections.find((item: { slug: string }) => item.slug === (process.argv[4] ?? config.defaultLlmConnection))
assert(connection?.defaultModel, 'The selected configured connection must have a model')
assert.equal(connection.defaultModel, 'gpt-6-luna', 'This acceptance uses the user-requested GPT-6-luna connection')
const client = new WsRpcClient(`ws://127.0.0.1:${config.serverConfig.port}`, {
  token: config.serverConfig.token, workspaceId: workspace.id, autoReconnect: false,
})
const errors: string[] = []
client.on(RPC_CHANNELS.sessions.EVENT, event => { if (event.type === 'error') errors.push(event.message) })
client.connect()
try {
  const resumeId = process.argv[3] === '-' ? undefined : process.argv[3]
  const root = resumeId ? await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, resumeId) : await client.invoke(RPC_CHANNELS.sessions.CREATE, workspace.id, {
    workMode: 'PRO', permissionMode: 'safe', model: connection.defaultModel,
    llmConnection: connection.slug, name: '正式安装包聊天闭环验收',
    workingDirectory: resolve(import.meta.dir, 'fixtures/selection-3.0'),
  })
  const began = resumeId ? root.createdAt : Date.now()
  console.log(`Package acceptance root: ${root.id}`)
  const source = resolve(import.meta.dir, 'fixtures/selection-3.0/costs.txt')
  const draft = resolve(import.meta.dir, 'fixtures/selection-3.0/draft.txt')
  if (!resumeId) await client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, root.id,
    `请建立并执行动态计划：先读取本地成本资料 ${JSON.stringify(source)} 与既存草稿 ${JSON.stringify(draft)}，由独立核验节点审查草稿；根据发现修正报告，再独立核验修正版，最后交付完整中文报告与修正说明。先展示简要计划，然后在当前只读授权内持续执行，不需要再次询问是否执行。报告区分A可确认的两年成本、B尚未核实的口径与风险缺口，保留原稿为历史，不捏造事实，不写文件、不改变权限。`)
  const deadline = Date.now() + 900_000
  let session, result
  while (Date.now() < deadline) {
    session = await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, root.id)
    if (!session.isProcessing && session.messages.some((message: { role: string }) => message.role === 'error')) break
    if (session.taskSlug) {
      result = await client.invoke(RPC_CHANNELS.tasks.GET_RESULTS, workspace.id, session.taskSlug)
      if (['failed', 'stopped', 'paused', 'interrupted', 'waiting-approval', 'waiting-budget'].includes(result.runStatus)) break
      if (result.runStatus === 'completed' && !session.isProcessing) break
    } else if (!session.isProcessing && session.messages.some((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const events = result?.runId ? readRunLog(workspace.rootPath, session.taskSlug, result.runId) : []
  const answers = session?.messages.filter((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)
  const finalText = answers?.at(-1)?.content ?? ''
  const record = { rootId: root.id, slug: session?.taskSlug, runId: result?.runId, status: result?.runStatus,
    model: connection.defaultModel, llmConnection: connection.slug, permissionMode: session?.permissionMode, elapsedMs: Date.now() - began,
    manualPlanEdits: 0, errors, result, events, finalText }
  writeFileSync('/tmp/selection-pro-package-acceptance.json', JSON.stringify(record, null, 2))
  const evidenceDirectory = join(directory, 'acceptance')
  mkdirSync(evidenceDirectory, { recursive: true })
  writeFileSync(join(evidenceDirectory, `${root.id}.json`), JSON.stringify(record, null, 2))
  assert.equal(record.status, 'completed')
  assert.equal(record.permissionMode, 'safe')
  assert(events.some(event => event.kind === 'coordinator-decision' && event.consumedResults?.length), 'The coordinator must consume recorded worker results')
  assert(result.nodes.some(node => /900[,.]?000/.test(node.output ?? '')), 'An independent inspection must identify the tenfold draft error and its difference')
  assert(events.filter(event => event.kind === 'node-verdict' && event.result === 'pass').length >= 2)
  const identities = events.filter(event => event.kind === 'node-spawned').map(event => event.sessionId)
  assert(new Set(identities).size >= 4, 'Both reviews must have independent contexts')
  assert(/100\s*万|1[,.]?000[,.]?000/.test(finalText) && finalText.includes('B') && finalText.includes('风险'))
  console.log(JSON.stringify({ ...record, result: undefined, events: events.length }, null, 2))
} finally { client.destroy() }
