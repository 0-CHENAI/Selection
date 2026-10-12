#!/usr/bin/env bun
/** One original, two model-authored nodes, one parent delivery on an ordinary installed host. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WsRpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const [directory, materials] = process.argv.slice(2)
assert(directory && materials, 'Usage: <installed-host-config> <new-fixture-directory>')
mkdirSync(materials, { recursive: true })
const source = join(resolve(materials), 'input.txt')
writeFileSync(source, 'TEST FIXTURE ONLY\n原文：方案 A 两年总成本为人民币 1,000,000 元（100 万元）。\n初稿：方案 A 两年总成本为人民币 100,000 元（10 万元）。\n', { flag: 'wx' })
const hash = () => createHash('sha256').update(readFileSync(source)).digest('hex')
const inputHashBefore = hash()
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
const workspace = config.workspaces[0]
const connection = config.llmConnections.find((item: { slug: string }) => item.slug === 'pi-api-key-2')
assert.equal(connection.defaultModel, 'gpt-6-luna')
const client = new WsRpcClient(`ws://127.0.0.1:${config.serverConfig.port}`, { token: config.serverConfig.token, workspaceId: workspace.id, autoReconnect: false })
client.connect()
const prompt = `这是一个最小本地验收，唯一输入是 ${source}，不得修改它。使用现有 PRO 编排，只创建两个节点：读取节点独立 Read 该文件，提交正确金额、初稿错误及原文行号；独立 verify 节点依赖读取结果，但必须自己再次 Read 原件，检查金额与引用并提交输出和节点判定。使用普通文本输出即可，不启用深度研究扩展，不创建其他节点或文件、不联网。异步启动后由正常检查点持续推进，完成后父代理用三句话交付正确金额、初稿错误和两节点复核结果。所有金额仅为 TEST FIXTURE ONLY。完全接管已授权，无需再次确认。`
const began = Date.now()
try {
  await client.invoke(RPC_CHANNELS.sessions.GET)
  const root = await client.invoke(RPC_CHANNELS.sessions.CREATE, workspace.id, {
    name: '最小 PRO 验收：读取 → 复核 → 交付', workMode: 'PRO', permissionMode: 'allow-all',
    model: connection.defaultModel, llmConnection: connection.slug, workingDirectory: resolve(materials),
  })
  console.log(JSON.stringify({ rootId: root.id, workMode: root.workMode, permissionMode: root.permissionMode }))
  await client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, root.id, prompt)
  let session, result, blocked = false
  for (;;) {
    session = await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, root.id)
    if (session.taskSlug) result = await client.invoke(RPC_CHANNELS.tasks.GET_RESULTS, workspace.id, session.taskSlug)
    const terminal = result && ['completed', 'failed', 'stopped', 'paused', 'interrupted', 'waiting-approval', 'waiting-budget'].includes(result.runStatus)
    const committed = session.messages.some((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)
    const error = session.messages.some((message: { role: string }) => message.role === 'error')
    blocked = !session.isProcessing && committed && result?.help?.some((help: { state: string }) => help.state === 'waiting')
      && !result.nodes.some((node: { state: string }) => node.state === 'running')
    if (blocked || (!session.isProcessing && (terminal || error || (!session.taskSlug && committed)))) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const all = await client.invoke(RPC_CHANNELS.sessions.GET)
  const children = all.filter((item: { parentSessionId?: string; orchestrationRootSessionId?: string }) => item.parentSessionId === root.id || item.orchestrationRootSessionId === root.id)
  const transcripts = [session, ...await Promise.all(children.map((child: { id: string }) => client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, child.id)))]
  const finalText = session.messages.findLast((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)?.content ?? ''
  const record = { rootId: root.id, taskSlug: session.taskSlug, workMode: session.workMode, permissionMode: session.permissionMode,
    model: connection.defaultModel, elapsedMs: Date.now() - began, status: blocked ? 'blocked-awaiting-help' : result?.runStatus ?? 'no-run', inputHashBefore, inputHash: hash(),
    manualPlanEdits: 0, manualOutputs: 0, prompt, finalText, result,
    sessions: transcripts.map(item => ({ id: item.id, workMode: item.workMode, permissionMode: item.permissionMode,
      calls: item.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { toolName: string; toolStatus: string; toolInput: unknown }) => ({ name: message.toolName, status: message.toolStatus, input: message.toolInput })) })),
  }
  writeFileSync(join(materials, 'result.json'), JSON.stringify(record, null, 2))
  console.log(JSON.stringify({ rootId: root.id, status: record.status, elapsedMs: record.elapsedMs, workers: children.length, finalText }))
  assert.equal(record.status, 'completed')
  assert.equal(session.workMode, 'PRO')
  assert.equal(session.permissionMode, 'allow-all')
  assert.equal(children.length, 2)
  assert.equal(result.nodes.length, 2)
  assert(result.nodes.every((node: { state: string }) => node.state === 'done'))
  assert.equal(result.verdict?.result, 'pass')
  assert.equal(record.inputHash, inputHashBefore)
  assert(/100\s*万|1[,.]?000[,.]?000/.test(finalText) && /10\s*万|100[,.]?000/.test(finalText))
  for (const worker of record.sessions.slice(1)) {
    assert.equal(worker.workMode, 'PRO')
    assert.equal(worker.permissionMode, 'allow-all')
    assert(worker.calls.some(call => /(?:^|__)Read$|document_read$/.test(call.name) && call.status === 'completed' && JSON.stringify(call.input).includes(source)), `${worker.id} must read the original independently`)
  }
} finally { client.destroy() }
