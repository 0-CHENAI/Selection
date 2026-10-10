#!/usr/bin/env bun
/** Same short goal on ordinary installed hosts; no authored plan, output or verdict injection. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WsRpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const [directory, materials, label, mode = 'PRO'] = process.argv.slice(2)
assert(directory && materials && label && ['PRO', 'NORM'].includes(mode), 'Usage: <ordinary-host-config> <new-fixtures> <current|baseline|norm> <PRO|NORM>')
assert(['current', 'baseline', 'norm'].includes(label))
assert.equal(mode, label === 'norm' ? 'NORM' : 'PRO')
mkdirSync(materials, { recursive: true })
const source = join(resolve(materials), 'input.txt')
writeFileSync(source, 'TEST FIXTURE ONLY\n原文：方案 A 两年总成本为人民币 1,000,000 元（100 万元）。\n旧草稿：方案 A 两年总成本为人民币 100,000 元（10 万元），尚未核实。\n方案 B 成本口径待核对，暂不能与方案 A 直接比较。\n风险资料仅说明存在未补齐的缺口，具体内容未知。\n', { flag: 'wx' })
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const inputHashBefore = digest(readFileSync(source))
const prompt = `这是最小成本研究验收，唯一输入是 ${source}。不得修改原件、不联网、不增加资料或结果文件；所有金额仅为 TEST FIXTURE ONLY。读取并保留旧草稿金额为待核实的历史结论，独立查阅原文发现错误，精确更正该结论版本，新的独立上下文复核修订版，最后交付简明中文报告与来源；保留 B 口径和风险未知边界。若本模式允许编排与结构化研究，使用现有 PRO 和内置 deep-research 契约，采用旧草稿、独立查错、纠正、新的独立复核、报告这五个必要步骤；研究者和两次 reviewer 都必须亲自 Read 冻结原文的相关行。将错误结论、精确版本勘误、修订版、独立审查、证伪条件、当前前提批判、来源包、局部阶段门和报告登记到现有研究记录，不用普通文本假冒结构化提交。原文证伪旧草稿是预期检查结果，区分节点完成与结论支持状态。只修事实不扩展前提分支，保留旧记录。若本模式不允许编排，则直接读取并交付同一问题的报告，明确独立上下文核验的限制，不尝试调用子代理。开始后持续推进至最终交付，无需再次确认；完全接管已授权。`
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
const workspace = config.workspaces[0]
const connection = config.llmConnections.find((item: { slug: string }) => item.slug === 'pi-api-key-2')
assert.equal(connection.defaultModel, 'gpt-6-luna')
const client = new WsRpcClient(`ws://127.0.0.1:${config.serverConfig.port}`, { token: config.serverConfig.token, workspaceId: workspace.id, autoReconnect: false })
client.connect()
const began = Date.now()
try {
  await client.invoke(RPC_CHANNELS.sessions.GET)
  const root = await client.invoke(RPC_CHANNELS.sessions.CREATE, workspace.id, {
    name: `最小结构化研究 ${label}`, workMode: mode, permissionMode: 'allow-all',
    model: connection.defaultModel, llmConnection: connection.slug, workingDirectory: resolve(materials),
  })
  console.log(JSON.stringify({ label, rootId: root.id, workMode: root.workMode, permissionMode: root.permissionMode }))
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
  const record = { label, rootId: root.id, taskSlug: session.taskSlug, workMode: session.workMode, permissionMode: session.permissionMode,
    model: connection.defaultModel, elapsedMs: Date.now() - began, status: blocked ? 'blocked-awaiting-help' : result?.runStatus ?? 'no-run',
    inputHashBefore, inputHash: digest(readFileSync(source)), prompt, normalizedPromptHash: digest(prompt.replaceAll(resolve(materials), '<fixtures>')),
    manualPlanEdits: 0, manualOutputs: 0, manualVerdicts: 0, result,
    finalText: session.messages.findLast((message: { role: string; answerCommitted?: boolean }) => message.role === 'assistant' && message.answerCommitted)?.content ?? '',
    sessions: transcripts.map(item => ({ id: item.id, workMode: item.workMode, permissionMode: item.permissionMode,
      calls: item.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { toolName: string; toolStatus: string; toolInput: unknown }) => ({ name: message.toolName, status: message.toolStatus, input: message.toolInput })) })),
  }
  const research = result?.research
  const checks: Record<string, boolean> = {
    inputUnchanged: record.inputHash === inputHashBefore,
    modeAndPermission: record.workMode === mode && record.permissionMode === 'allow-all',
    originalRead: record.sessions.some(item => item.calls.some(call => /(?:^|__)Read$/.test(call.name) && call.status === 'completed' && JSON.stringify(call.input).includes(source)))
      || Boolean(research?.sources.some((snapshot: { id: string; hash: string; version: string; originalPath: string }) => snapshot.hash === inputHashBefore && snapshot.originalPath.endsWith(source)
        && research.reads.some((receipt: { sourceId: string; sourceVersion: string; contentHash: string; startLine: number; endLine: number }) => receipt.sourceId === snapshot.id && receipt.sourceVersion === snapshot.version
          && receipt.contentHash === inputHashBefore && receipt.startLine <= 2 && receipt.endLine >= 3))),
    correctCost: /100\s*万|1[,.]?000[,.]?000/.test(record.finalText),
    limitsDisclosed: record.finalText.includes('B') && /风险/.test(record.finalText) && /未知|待|缺口|未核/.test(record.finalText),
  }
  if (mode === 'NORM') {
    checks.noDelegation = children.length === 0 && !session.taskSlug
    checks.finalDelivery = record.finalText.length > 0 && !session.messages.some((message: { role: string }) => message.role === 'error')
  } else {
    checks.completed = record.status === 'completed' && result.nodes.every((node: { state: string }) => node.state === 'done')
    checks.structuredResearch = research?.assuranceVersion === 2
    checks.exactErrataResolved = research?.errata.length > 0 && research.errata.every((item: { id: string; state: string }) => item.state === 'resolved' && research.report?.erratumIds?.includes(item.id))
    checks.correctedIndependentSupport = research?.claims.some((claim: { version: number; review?: { support: string }; reviewer?: { sessionId: string }; producedBy: { sessionId: string } }) => claim.version > 1 && claim.review?.support === 'supported' && claim.reviewer?.sessionId !== claim.producedBy.sessionId) ?? false
    checks.originalReadsAndBundle = research?.reads.length >= 3 && research.sourceBundle?.cited.some((item: { readIds: string[] }) => item.readIds.length >= 2)
    checks.freshPremiseAndGate = research?.judgment?.critiques.some((item: { current: boolean }) => item.current) && research.judgment.stages.every((item: { state: string }) => ['deliverable', 'limited-delivery'].includes(item.state))
    checks.noResearchBlockers = research?.blockers.length === 0
  }
  const evidence = { ...record, toolCalls: record.sessions.reduce((total, item) => total + item.calls.length, 0), workers: children.length,
    checks: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Boolean(value)])) }
  writeFileSync(join(materials, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ label, rootId: root.id, status: record.status, elapsedMs: record.elapsedMs, toolCalls: evidence.toolCalls, workers: children.length, checks: evidence.checks }))
  // A historical baseline may fail: keep the comparable observation rather than patching it to pass.
  if (label !== 'baseline') for (const [name, passed] of Object.entries(evidence.checks)) assert(passed, name)
} finally { client.destroy() }
