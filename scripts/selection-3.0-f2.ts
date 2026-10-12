#!/usr/bin/env bun
/** F2 uses the real host/model; handover itself never starts a model or copies authority. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { getSessionFilePath, getSessionPath, loadSession } from '@craft-agent/shared/sessions'
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
    name: '#452 F2 原始成本分析', model: connection.defaultModel, llmConnection: connection.slug,
    workingDirectory: join(repo, 'scripts/fixtures/selection-3.0') })
  await manager.sendMessage(source.id, `读取 ${JSON.stringify(join(repo,'scripts/fixtures/selection-3.0/costs.txt'))}。目标是比较 A/B 两年成本和风险。约束：只读约定资料，不部署、不执行外部操作。先给资料摘要，列出未决问题和下一步；不能核实的成本口径与风险资料明确标为未知。`)
  await manager.flushAllSessions()
  const before = readFileSync(getSessionFilePath(workspace.rootPath, source.id),'utf8')
  const handoverId = randomUUID()
  const pro = (await manager.handoverSession(source.id, { type: 'create', handoverId, targetMode: 'PRO' })).records[0]!
  assert.equal(pro.status,'applied')
  assert.equal((await manager.handoverSession(source.id, { type:'create',handoverId,targetMode:'PRO' })).records[0]!.targetSessionId,pro.targetSessionId)
  assert.equal(readFileSync(getSessionFilePath(workspace.rootPath,source.id),'utf8'),before)
  assert(pro.snapshot!.constraints.some(text=>text.includes('不部署')))
  assert(pro.snapshot!.files.length,'Real read input must have a frozen file snapshot')
  const target = await manager.getSession(pro.targetSessionId!)
  assert(target && target.workMode === 'PRO' && target.permissionMode === 'safe' && !target.parentSessionId)
  assert.equal(target.model,connection.defaultModel)
  await manager.sendMessage(target.id,'请依据收到的交接背景继续原目标，读冻结快照后给一份简短报告。确认 A 两年成本，明确 B 口径与风险缺口的限制。不要重复已完成操作或继续源运行。仍然只读，不部署。')
  const proOutput = manager.getSessionFinalText(target.id)!
  assert(/1000000|1,000,000|100\s*万/.test(proOutput),'Original A cost must survive handover')
  assert(/未知|待核|缺口|无法/.test(proOutput),'Limitations must remain visible')
  const back = (await manager.handoverSession(target.id,{type:'create',handoverId:randomUUID(),targetMode:'NORM'})).records[0]!
  assert.equal(back.status,'applied')
  const norm = await manager.getSession(back.targetSessionId!)
  assert(norm && norm.workMode === 'NORM' && !norm.parentSessionId && norm.permissionMode === 'safe')
  await manager.sendMessage(norm.id,'请基于交接的成果继续聊：下一步最应该核实哪些问题？保持原限制，说明 A 两年成本和仍未知的部分。只读，不部署。')
  const normOutput = manager.getSessionFinalText(norm.id)!
  assert(/1000000|1,000,000|100\s*万/.test(normOutput))
  assert(/未知|待核|缺口|无法/.test(normOutput))
  await manager.flushAllSessions()
  assert.equal(loadSession(workspace.rootPath,target.id)!.messages.filter(message=>message.id === `handover-${handoverId}`).length,1)
  for (const record of [pro,back]) for (const file of record.snapshot!.files) assert(readFileSync(join(getSessionPath(workspace.rootPath,record.targetSessionId!),'data','handover',record.handoverId,file.snapshotPath)).length)
  Object.assign(records,{workspaceId:workspace.id,model:connection.defaultModel,connection:connection.slug,sourceSessionId:source.id,pro,normHandover:back,proOutput,normOutput,sourceUnchangedAtHandover:true,backgroundAppliedOnce:true})
  writeFileSync('/tmp/selection-version-3.0/452-f2-real.json',JSON.stringify(records,null,2))
  console.log(JSON.stringify({sourceSessionId:source.id,proSessionId:target.id,normSessionId:norm.id,proOutput,normOutput},null,2))
} finally { await manager.flushAllSessions();manager.cleanup() }
