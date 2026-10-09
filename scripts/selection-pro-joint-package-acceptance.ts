#!/usr/bin/env bun
/** Controlled comparison through ordinary installed hosts; plans/results stay model-authored. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WsRpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { readRunLog } from '@craft-agent/shared/tasks'

const [directory, label, workMode, materials, existingId] = process.argv.slice(2)
assert(directory && label && ['PRO', 'NORM'].includes(workMode!) && materials, 'Usage: <config> <label> <PRO|NORM> <materials> [existing-session]')
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
const workspace = config.workspaces[0], connection = config.llmConnections.find((item: { slug: string }) => item.slug === 'pi-api-key-2')
assert.equal(connection.defaultModel, 'gpt-6-luna')
const client = new WsRpcClient(`ws://127.0.0.1:${config.serverConfig.port}`, { token: config.serverConfig.token, workspaceId: workspace.id, autoReconnect: false })
client.connect()
try {
  const root = existingId ? await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, existingId) : await client.invoke(RPC_CHANNELS.sessions.CREATE, workspace.id, {
    name: `受控整包验收 ${label}`, workMode, permissionMode: 'safe', model: connection.defaultModel, llmConnection: connection.slug, workingDirectory: resolve(materials),
  })
  const began = existingId ? root.createdAt : Date.now()
  console.log(JSON.stringify({ label, rootId: root.id, workMode }))
  if (!existingId) await client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, root.id,
    `请调研并完整交付本地冻结测试资料中的两年成本与风险报告。目录 ${JSON.stringify(resolve(materials))} 中 costs.txt 是测试资料，draft.txt 是需要证伪和更正的既存初稿；cost.pdf、cost.docx、cost.xlsx、cost.pptx 是相同成本事实的原生长材料，需先索引定位再读取原文核对。不得修改原文件，任何金额都仅限 TEST FIXTURE ONLY。
在当前只读授权内持续完成；若本模式支持任务编排，建立并执行计划，由独立上下文审查关键引用、原文读取、金额勘误及最终报告；并行读取独立材料。记录初稿错误的版本、精确勘误及修正版的独立复核，不覆盖旧记录。为重要结论记录可证伪条件与前提，检查将两年总额作为单年成本这一替代前提是否成立并说明采用与否，按局部阶段门决定是否交付。B 的成本口径待核对、风险缺口不得推测补齐；如节点需要决策，应向当前父节点求助并在原上下文继续，回复不扩大权限。遇到不可验证内容应注明限制而不是反复重试。最后给出简体中文报告与来源，区分确认事实、不同前提和未知项；如本模式无法独立复核，直接说明这一限制。开始前简述计划，然后持续执行到交付，不需要再次确认。`)
  let session, result, blocked = false
  for (;;) {
    session = await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, root.id)
    if (session.taskSlug) {
      result = await client.invoke(RPC_CHANNELS.tasks.GET_RESULTS, workspace.id, session.taskSlug)
      // A coordinator can still be finishing an explanation or self-repair
      // after a protected pause. Observe that turn before declaring it terminal.
      if (!session.isProcessing && ['failed', 'stopped', 'paused', 'interrupted', 'waiting-approval', 'waiting-budget'].includes(result.runStatus)) break
      if (result.runStatus === 'completed' && !session.isProcessing) break
      // An idle coordinator's committed refusal with every worker waiting for help is a deadlock,
      // not ongoing background progress. Preserve the failed evidence without patching the plan.
      const last = session.messages.at(-1)
      if (!session.isProcessing && last?.role === 'assistant' && last.answerCommitted
        && result.help?.some((help: { state: string }) => help.state === 'waiting')
        && !result.nodes?.some((node: { state: string }) => node.state === 'running')) {
        blocked = true; break
      }
    } else if (!session.isProcessing && session.messages.some((message: { answerCommitted?: boolean; role: string }) => message.role === 'assistant' && message.answerCommitted)) break
    const currentTurn = session.messages.slice(session.messages.findLastIndex((message: { role: string }) => message.role === 'user') + 1)
    if (!session.isProcessing && currentTurn.some((message: { role: string }) => message.role === 'error')) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const all = await client.invoke(RPC_CHANNELS.sessions.GET)
  const children = all.filter((candidate: { parentSessionId?: string; orchestrationRootSessionId?: string }) => candidate.parentSessionId === root.id || candidate.orchestrationRootSessionId === root.id)
  const transcripts = [session, ...await Promise.all(children.map((child: { id: string }) => client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, child.id)))]
  const calls = transcripts.flatMap(item => item.messages.filter((message: { role: string }) => message.role === 'tool'))
  const events = result?.runId ? readRunLog(workspace.rootPath, session.taskSlug, result.runId) : []
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const promptHash = digest(session.messages.find((message: { role: string }) => message.role === 'user')?.content ?? '')
  const inputHashes = Object.fromEntries(['costs.txt', 'draft.txt', 'cost.pdf', 'cost.docx', 'cost.xlsx', 'cost.pptx']
    .map(name => [name, digest(readFileSync(join(materials, name)))]))
  const record = { label, rootId: root.id, model: connection.defaultModel, requestedPermissionMode: 'safe', permissionMode: session.permissionMode, workMode, status: blocked ? 'blocked-awaiting-help' : result?.runStatus ?? (session.messages.some((message: { role: string }) => message.role === 'error') ? 'failed' : 'completed'),
    promptHash, inputHashes, elapsedMs: Date.now() - began, toolCalls: calls.length, workers: children.length, manualPlanEdits: 0, manualOutputs: 0, result, events,
    finalText: session.messages.findLast((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)?.content ?? '',
    calls: calls.map((message: { toolName: string; toolUseId: string; toolStatus: string }) => ({ name: message.toolName, id: message.toolUseId, status: message.toolStatus })),
  }
  mkdirSync(join(directory, 'acceptance'), { recursive: true })
  writeFileSync(join(directory, 'acceptance', `${label}.json`), JSON.stringify(record, null, 2))
  console.log(JSON.stringify({ label, rootId: root.id, status: record.status, elapsedMs: record.elapsedMs, toolCalls: record.toolCalls, workers: record.workers, events: events.length }))
  assert.equal(record.status, 'completed')
  assert(/100\s*万|1[,.]?000[,.]?000/.test(record.finalText), 'The final report must state the confirmed cost')
  assert(record.finalText.includes('B') && /风险|缺口/.test(record.finalText))
} finally { client.destroy() }
