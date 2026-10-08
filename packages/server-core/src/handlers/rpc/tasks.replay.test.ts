import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { TaskSpecSchema, appendRunLog, writeSpecRevision } from '@craft-agent/shared/tasks'
import { registerTasksHandlers } from './tasks'
import type { HandlerDeps } from '../handler-deps'
import type { RpcServer } from '../../transport'
const files = (root: string): unknown[] => readdirSync(root, { withFileTypes: true }).map(item => [item.name, item.isDirectory() ? files(join(root, item.name)) : readFileSync(join(root, item.name)).toString('base64')])

test('history inspection RPC uses exact durable revisions without starting recovery, models or writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-rpc-'))
  const workspace = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>)
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  let modelCalls = 0
  try {
    const spec = TaskSpecSchema.parse({ schema_version: 3, id: 'history', title: 'History', goal: 'g', nodes: [{ id: 'read', prompt: '原文' }] })
    writeSpecRevision(root, 'history', 'run', 0, spec)
    appendRunLog(root, 'history', 'run', { kind: 'run-started', t: '2026-10-07T00:00:00Z', taskId: 'history', runId: 'run', revision: 0, seq: 1 })
    registerTasksHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn) } as unknown as RpcServer, {
      sessionManager: { setTaskRunnerLookup() {}, waitForInit: () => new Promise(() => {}), async createSession() { modelCalls++; throw new Error('Unexpected execution') }, async sendMessage() { modelCalls++; throw new Error('Unexpected execution') } },
    } as unknown as HandlerDeps)
    const before = files(root)
    const result = await handlers.get(RPC_CHANNELS.tasks.INSPECT_RUN)!({}, 'ws', 'history', 'run', 1)
    expect(result).toMatchObject({ readOnly: true, cursor: 1, total: 1, spec: { title: 'History' } })
    expect(files(root)).toEqual(before); expect(modelCalls).toBe(0)
    await expect(handlers.get(RPC_CHANNELS.tasks.INSPECT_RUN)!({}, 'ws', '../escape', 'run')).rejects.toThrow()
    expect(files(root)).toEqual(before)
  } finally { workspace.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
