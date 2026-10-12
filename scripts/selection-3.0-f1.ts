#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner } from '@craft-agent/server-core/tasks'
import { runPreToolUseChecks, type PreToolUseInput } from '../packages/shared/src/agent/core/pre-tool-use'
import { latestTaskList } from '@craft-agent/shared/utils/task-list'
import { loadSession } from '@craft-agent/shared/sessions'

const repo = resolve(import.meta.dir, '..')
const workspace = getWorkspaces()[0]
const connection = getLlmConnections().find(item => item.slug === getDefaultLlmConnection())
assert(workspace && connection)
setBundledAssetsRoot(join(repo, 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
const internal = manager as unknown as { sessions: Map<string, { id: string; workMode?: string }>; spawnSessionFromTool: (session: unknown, input: unknown) => Promise<unknown> }
const taskSlugs = readdirSync(join(workspace.rootPath, 'tasks')).sort()
try {
  await manager.reinitializeAuth()
  const session = await manager.createSession(workspace.id, { workMode: 'NORM', hidden: true, permissionMode: 'safe',
    name: '#451 F1 NORM 边界验收', model: connection.defaultModel, llmConnection: connection.slug,
    workingDirectory: join(repo, 'scripts/fixtures/selection-3.0') })
  const managed = internal.sessions.get(session.id)!
  const refusals: Record<string, string> = {}
  for (const spawnReason of ['automatic', 'user-requested']) {
    await assert.rejects(internal.spawnSessionFromTool(managed, { name: 'Rejected worker', prompt: 'read costs', spawnReason }), error => {
      assert(error instanceof Error && error.message.includes('NORM')); refusals[spawnReason] = error.message; return true
    })
  }
  const runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath })
  assert.throws(() => runner.run('must-not-exist', { orchestratorSessionId: session.id }), /NORM/)
  assert.throws(() => manager.assertTaskRunAllowed(workspace.id, session.id), /NORM/)
  for (const toolName of ['Task', 'Agent', 'mcp__session__spawn_session', 'send_agent_message', 'create_task', 'run_task', 'mcp__session__submit_task_definition']) {
    const result = runPreToolUseChecks({ toolName, executionSession: session } as unknown as PreToolUseInput)
    assert(result.type === 'block' && result.reason.includes('NORM')); refusals[toolName] = result.reason
  }
  await manager.sendMessage(session.id, `读取 ${JSON.stringify(join(repo, 'scripts/fixtures/selection-3.0/costs.txt'))}。请把工作分成读取资料、确认A两年成本、列出未核实缺口三个可验收步骤并维护任务清单。完成全部步骤；如果无法委派，就在当前会话完成。不得修改文件。`)
  const result = await manager.getSession(session.id)
  assert(result && result.workMode === 'NORM')
  assert.equal(result.permissionMode, 'safe')
  assert.equal(result.model, connection.defaultModel)
  assert(manager.sessionUsedTools(session.id))
  assert(manager.getSessionFinalText(session.id)?.replace(/[,，\s]/g, '').includes('1000000') || manager.getSessionFinalText(session.id)?.includes('100 万'))
  const list = latestTaskList(result.messages)
  assert(list?.length && list.every(item => item.status === 'completed'))
  assert.equal(internal.sessions.size, 1, 'No worker was created')
  assert.deepEqual(readdirSync(join(workspace.rootPath, 'tasks')).sort(), taskSlugs)
  await manager.flushAllSessions()
  const disk = loadSession(workspace.rootPath, session.id)!
  assert.equal(disk.workMode, 'NORM'); assert.deepEqual(latestTaskList(disk.messages), list)
  const record = { sessionId: session.id, workspaceId: workspace.id, mode: disk.workMode, model: disk.model,
    permissionMode: disk.permissionMode, list, refusals, workerCount: 0, unchangedTasks: true, output: manager.getSessionFinalText(session.id) }
  writeFileSync('/tmp/selection-version-3.0/451-f1-real.json', JSON.stringify(record, null, 2))
  console.log(JSON.stringify(record, null, 2))
} finally { await manager.flushAllSessions(); manager.cleanup() }
