#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { latestTaskList, isTaskListTool } from '@craft-agent/shared/utils/task-list'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { loadSession as loadStoredSession } from '@craft-agent/shared/sessions'

const repo = resolve(import.meta.dir, '..')
const workspace = getWorkspaces().find(w => !process.env.F0_WORKSPACE_ID || w.id === process.env.F0_WORKSPACE_ID)
const connection = getLlmConnections().find(c => c.slug === (process.env.F0_LLM_CONNECTION ?? getDefaultLlmConnection()))
assert(workspace && connection?.defaultModel)
setBundledAssetsRoot(join(repo, 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
const before = readdirSync(join(workspace.rootPath, 'tasks')).sort()
try {
  await manager.reinitializeAuth()
  const options = { hidden: true, permissionMode: 'safe' as const, model: connection.defaultModel, llmConnection: connection.slug,
    workingDirectory: join(repo, 'scripts/fixtures/selection-3.0') }
  const session = await manager.createSession(workspace.id, { ...options, name: '#337 真实清单验收' })
  await manager.sendMessage(session.id, `这项工作有三个可验收步骤：1. 读取 ${JSON.stringify(join(repo, 'scripts/fixtures/selection-3.0/costs.txt'))}，确认A的两年成本；2. 区分已核实信息和未核实缺口；3. 整理最终报告。现在只完成前两项，第三项等我说继续再完成。保留清单进度。不得委派或修改文件。`)
  const first = await manager.getSession(session.id)
  assert(first)
  const firstList = latestTaskList(first.messages)
  assert(firstList && firstList.some(item => item.status === 'pending'), 'Pending work must be saved in a Task List')
  const firstSnapshot = JSON.stringify(first.messages.filter(message => isTaskListTool(message.toolName)))
  const firstIds = new Set(first.messages.map(message => message.id))
  await manager.flushAllSessions()
  assert.deepEqual(latestTaskList(loadStoredSession(workspace.rootPath, session.id)!.messages), firstList)
  await manager.sendMessage(session.id, '继续，完成剩余最终报告。保留之前完成的工作，不要重做读取。')
  const continued = await manager.getSession(session.id)
  assert(continued)
  const last = latestTaskList(continued.messages)
  assert(last?.length && last.every(item => item.status === 'completed'), 'Continuation must complete the remaining plan')
  assert.equal(JSON.stringify(continued.messages.filter(message => firstIds.has(message.id) && isTaskListTool(message.toolName))), firstSnapshot)
  const simple = await manager.createSession(workspace.id, { ...options, name: '#337 简单问答回归' })
  await manager.sendMessage(simple.id, '100万元平分到两年，每年多少万元？只需要一句话。')
  const answer = await manager.getSession(simple.id)
  assert(answer && !answer.messages.some(message => isTaskListTool(message.toolName)))
  assert.deepEqual(readdirSync(join(workspace.rootPath, 'tasks')).sort(), before)
  assert(!continued.taskSlug && !continued.parentSessionId)
  const record = { workspaceId: workspace.id, connection: connection.slug, model: connection.defaultModel,
    sessionId: session.id, firstList, last, output: manager.getSessionFinalText(session.id), simpleSessionId: simple.id,
    simpleAnswer: manager.getSessionFinalText(simple.id), unchangedTaskDirectory: true, immutableEarlierSnapshot: true }
  writeFileSync(process.env.TASK_LIST_RECORD_PATH ?? '/tmp/selection-version-3.0/337-real.json', JSON.stringify(record, null, 2))
  console.log(JSON.stringify(record, null, 2))
} finally {
  await manager.flushAllSessions()
  manager.cleanup()
}
