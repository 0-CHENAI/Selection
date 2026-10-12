#!/usr/bin/env bun
/** Real-model regression: an atomic Edit failure must not disable the next PRO conversation. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { getSessionPath } from '@craft-agent/shared/sessions'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { HandoverStore } from '../packages/server-core/src/reliability/handover-store'

const workspace = getWorkspaces()[0]
const connection = getLlmConnections().find(connection => connection.slug === getDefaultLlmConnection())
assert(workspace && connection)
const model = process.argv[2] ?? connection.defaultModel
setBundledAssetsRoot(join(resolve(import.meta.dir, '..'), 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
const directory = mkdtempSync(join(tmpdir(), 'selection-pro-handover-qa-'))
const sourceFile = join(directory, 'unchanged.txt'), outputFile = join(directory, 'pro-write.html')
writeFileSync(sourceFile, 'original QA fixture')
const sessions: string[] = [], handoverId = randomUUID()
const store = new HandoverStore(join(workspace.rootPath, 'handovers'), workspace.id)
try {
  await manager.reinitializeAuth()
  const source = await manager.createSession(workspace.id, { workMode: 'NORM', permissionMode: 'allow-all', hidden: true,
    name: 'QA：失败编辑后的 PRO 写入', model, llmConnection: connection.slug, workingDirectory: directory })
  sessions.push(source.id)
  await manager.sendMessage(source.id, `这是隔离的回归测试。只调用一次原生 Edit 编辑 ${JSON.stringify(sourceFile)}，将 __MISSING_QA_TEXT__ 替换为 changed。预期文本匹配失败，失败后不要重试、不要使用其他写入工具、不修改文件，报告工具的实际失败结果。`)
  await manager.flushAllSessions()
  assert.equal(readFileSync(sourceFile, 'utf8'), 'original QA fixture')
  const record = (await manager.handoverSession(source.id, { type: 'create', handoverId, targetMode: 'PRO' })).records[0]!
  assert.equal(record.status, 'applied')
  sessions.push(record.targetSessionId!)
  assert(record.snapshot!.actions.some(action => action.tool === 'Edit' && action.outcome === 'not-performed'))
  assert(!record.snapshot!.actions.some(action => action.outcome === 'unknown'))
  const target = await manager.getSession(record.targetSessionId!)
  assert(target?.workMode === 'PRO' && target.permissionMode === 'allow-all')
  await manager.sendMessage(target.id, `继续隔离的回归测试。现在授权仅用原生 Write 新建 ${JSON.stringify(outputFile)}，内容必须准确为 <!doctype html><title>PRO handover QA</title><p>handover-write-ok</p>。不要重试之前的失败编辑、不修改原文件、不调用 Bash、委派或工作流。写入成功后简短报告实际结果。`)
  await manager.flushAllSessions()
  assert.equal(readFileSync(outputFile, 'utf8'), '<!doctype html><title>PRO handover QA</title><p>handover-write-ok</p>')
  assert.equal(readFileSync(sourceFile, 'utf8'), 'original QA fixture')
  const messages = (await manager.getSession(target.id))!.messages
  assert(messages.some(message => message.toolName === 'Write' && message.toolStatus === 'completed' && !message.isError))
  const result = { model, sourceSessionId: source.id, proSessionId: target.id,
    sourceEditOutcome: 'not-performed', unknownActions: 0, proWriteSucceeded: true, sourceFileUnchanged: true,
    permissionMode: target.permissionMode }
  writeFileSync(join(tmpdir(), 'selection-pro-handover-write-qa.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await manager.flushAllSessions()
  for (const id of sessions.reverse()) await manager.deleteSession(id)
  manager.cleanup()
  rmSync(store.directory(handoverId), { recursive: true, force: true })
  rmSync(directory, { recursive: true, force: true })
}
