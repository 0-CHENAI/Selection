#!/usr/bin/env bun
/** F2 (#793): same conversation, NORM→PRO→NORM. Mode switch does not create a session. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { getSessionFilePath, loadSession } from '@craft-agent/shared/sessions'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'

const repo = resolve(import.meta.dir, '..')
const workspace = getWorkspaces()[0]
const connection = getLlmConnections().find(connection => connection.slug === getDefaultLlmConnection())
assert(workspace && connection)
setBundledAssetsRoot(join(repo, 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
const records: Record<string, unknown> = {}
try {
  await manager.reinitializeAuth()
  const source = await manager.createSession(workspace.id, { workMode: 'NORM', permissionMode: 'safe', hidden: true,
    name: '#793 F2 同一会话成本分析', model: connection.defaultModel, llmConnection: connection.slug,
    workingDirectory: join(repo, 'scripts/fixtures/selection-3.0') })
  await manager.sendMessage(source.id, `读取 ${JSON.stringify(join(repo,'scripts/fixtures/selection-3.0/costs.txt'))}。目标是比较 A/B 两年成本和风险。约束：只读约定资料，不部署、不执行外部操作。先给资料摘要，列出未决问题和下一步；不能核实的成本口径与风险资料明确标为未知。`)
  await manager.flushAllSessions()
  const sourceId = source.id
  await manager.setSessionWorkMode(sourceId, 'PRO')
  const afterPro = await manager.getSession(sourceId)
  assert(afterPro && afterPro.workMode === 'PRO' && afterPro.id === sourceId)
  await manager.sendMessage(sourceId,'请依据同一会话历史继续原目标。确认 A 两年成本，明确 B 口径与风险缺口的限制。不要重复已完成操作。仍然只读，不部署。')
  const proOutput = manager.getSessionFinalText(sourceId)!
  assert(/1000000|1,000,000|100\s*万/.test(proOutput),'Original A cost must survive the strategy switch')
  assert(/未知|待核|缺口|无法/.test(proOutput),'Limitations must remain visible')
  await manager.setSessionWorkMode(sourceId, 'NORM')
  const afterNorm = await manager.getSession(sourceId)
  assert(afterNorm && afterNorm.workMode === 'NORM' && afterNorm.id === sourceId)
  await manager.sendMessage(sourceId,'请基于同一会话的成果继续聊：下一步最应该核实哪些问题？保持原限制，说明 A 两年成本和仍未知的部分。只读，不部署。')
  const normOutput = manager.getSessionFinalText(sourceId)!
  assert(/1000000|1,000,000|100\s*万/.test(normOutput))
  assert(/未知|待核|缺口|无法/.test(normOutput))
  await manager.flushAllSessions()
  const stored = loadSession(workspace.rootPath, sourceId)!
  assert.equal(stored.id, sourceId)
  assert(stored.messages.some(message => typeof message.content === 'string' && message.content.includes('两年成本')))
  Object.assign(records,{workspaceId:workspace.id,model:connection.defaultModel,connection:connection.slug,sessionId:sourceId,proOutput,normOutput,sameSession:true})
  writeFileSync('/tmp/selection-version-3.0/452-f2-real.json',JSON.stringify(records,null,2))
  console.log(JSON.stringify({sessionId:sourceId,proOutput,normOutput},null,2))
} finally { await manager.flushAllSessions();manager.cleanup() }
