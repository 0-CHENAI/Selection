import { execFileSync } from 'node:child_process'
import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import * as configStorage from '@craft-agent/shared/config/storage'
import { SessionManager, createManagedSession } from './SessionManager'

for (const { conflict, mode, declared } of [
  { conflict: false, mode: 'wait' as const, declared: true },
  { conflict: true, mode: 'wait' as const, declared: true },
  { conflict: false, mode: 'background' as const, declared: true },
  { conflict: true, mode: 'background' as const, declared: true },
  { conflict: false, mode: 'wait' as const, declared: false },
]) test(`Swarm ${mode} delivers real isolated files only after integration (conflict=${conflict}, declared=${declared})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'swarm-e2e-'))
  const workspace = { id: 'swarm-e2e', name: 'Test', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project')
  mkdirSync(project, { recursive: true }); writeFileSync(join(project, 'result.txt'), 'base\n')
  if (!declared) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test'); git('add', '.'); git('commit', '-m', 'base')
  }
  const expectedOutputs: Record<string, string> = declared ? { result: 'result.txt' } : { 'result.txt': 'result.txt' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const enabled = spyOn(configStorage, 'getSwarmAgentsEnabled').mockReturnValue(true)
  const manager = new SessionManager(), internal = manager as any
  const parent = createManagedSession({ id: 'parent', permissionMode: 'allow-all', workingDirectory: project }, workspace as never, { messagesLoaded: true })
  parent.isProcessing = true
  internal.sessions.set(parent.id, parent)
  internal.persistSession = () => {}
  internal.flushSession = async () => {}
  internal.issueSpawnQualificationCredentials(parent, 'user-requested')
  manager.onSessionComplete(event => internal.surfaceSpawnedSessionCompletion(event))
  internal.createSession = async (_workspaceId: string, options: any) => {
    const child = createManagedSession({ ...options, id: 'child' }, workspace as never, { messagesLoaded: true })
    internal.sessions.set(child.id, child)
    return { id: child.id, name: 'child' }
  }
  const completion = new Promise<any>(resolve => manager.onSessionComplete(event => { if (event.sessionId === 'child') resolve(event) }))
  let candidateDirectory: string | undefined
  internal.sendMessage = async (id: string, prompt: string) => {
    const child = internal.sessions.get(id)
    candidateDirectory = child.workingDirectory
    expect(candidateDirectory).not.toBe(project)
    if (declared) {
      expect(prompt).toContain('"result":"result.txt"')
      expect(child.isolatedWorkspace.deliveryContract.outputs).toEqual(expectedOutputs)
    } else expect(child.isolatedWorkspace.autoDelivery).toBe(true)
    writeFileSync(join(candidateDirectory!, 'result.txt'), 'candidate\n')
    if (conflict) writeFileSync(join(project, 'result.txt'), 'external\n')
    child.messages.push({ id: 'answer', role: 'assistant', content: 'Updated the declared result file.', timestamp: Date.now(), isIntermediate: false, answerCommitted: true })
    child.isProcessing = true
    await internal.onProcessingStopped(id, 'complete', child.processingGeneration)
  }
  try {
    const result = await internal.spawnSessionFromTool(parent, { prompt: 'update file', spawnReason: 'user-requested', mode, timeoutMs: 1000, ...(declared ? { artifactDelivery: { inputs: ['result.txt'], outputs: { result: 'result.txt' } } } : {}) })
    const delivered = await completion
    expect(result.status).toBe(mode === 'background' ? 'started' : conflict ? 'failed' : 'completed')
    expect(delivered.reason).toBe(conflict ? 'error' : 'complete')
    const details = manager.getSwarmRunDetails(parent.id, workspace.id)
    const delivery = details?.nodes.find(node => node.sessionId === 'child')?.artifactDelivery
    expect(delivery?.phase).toBe(conflict ? 'conflict' : 'integrated')
    expect(delivery?.outputs).toEqual(expectedOutputs)
    expect(delivery?.conflicts).toEqual(conflict ? ['result.txt'] : [])
    const artifacts = mode === 'wait' ? result.artifacts : delivered.artifacts
    expect(readFileSync(join(project, 'result.txt'), 'utf8')).toBe(conflict ? 'external\n' : 'candidate\n')
    expect(readFileSync(join(candidateDirectory!, 'result.txt'), 'utf8')).toBe('candidate\n')
    if (conflict) expect(artifacts).toBeUndefined()
    else {
      expect(artifacts[declared ? 'result' : 'result.txt'].path).toBe(join(realpathSync(project), 'result.txt'))
      expect(artifacts[declared ? 'result' : 'result.txt'].artifactDeliveryVersion).toBe(1)
      if (mode === 'background') {
        const output = parent.backgroundTaskOutputs.get('child')
        expect(output?.summary).toContain(artifacts[declared ? 'result' : 'result.txt'].path)
        expect(output?.summary).not.toContain(candidateDirectory!)
      }
    }
  } finally { lookup.mockRestore(); enabled.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
