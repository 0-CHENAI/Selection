import { execFileSync } from 'node:child_process'
import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as config from '@craft-agent/shared/config'
import { getSessionPath } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager'
import { prepareIsolatedWorkspace } from '../reliability/isolated-workspace'

for (const sourceCode of [false, true]) for (const pending of [false, true]) test(`SessionManager replays delivery after reload without applying candidate edits (pending=${pending}, code=${sourceCode})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'manager-delivery-'))
  const workspace = { id: 'delivery-workspace', name: 'Delivery', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project')
  const filename = sourceCode ? 'result.ts' : 'result.txt'
  mkdirSync(project, { recursive: true }); writeFileSync(join(project, filename), 'base')
  if (sourceCode) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(join(project, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
    writeFileSync(join(project, 'check.ts'), `import {readFileSync} from 'node:fs'; if (readFileSync('result.ts','utf8') !== 'approved') process.exit(1);`)
    git('add', '.'); git('commit', '-m', 'base')
  }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'delivery', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
    managed.isolatedWorkspace = prepareIsolatedWorkspace(project, join(root, 'isolated'), [filename])
    writeFileSync(join(managed.isolatedWorkspace.directory, filename), 'approved')
    ;(manager as any).sessions.set(managed.id, managed)
    if (sourceCode) {
      writeFileSync(join(managed.isolatedWorkspace.directory, filename), 'rejected candidate')
      await expect(manager.finalizeTaskWorkspace(managed.id, { file: filename }, () => {})).rejects.toThrow('failed')
      expect(readFileSync(join(project, filename), 'utf8')).toBe('base')
      expect(readFileSync(join(managed.isolatedWorkspace.directory, filename), 'utf8')).toBe('rejected candidate')
      expect(managed.isolatedWorkspace.delivery).toBeUndefined()
      writeFileSync(join(managed.isolatedWorkspace.directory, filename), 'approved')
    }
    const first = await manager.finalizeTaskWorkspace(managed.id, { file: filename }, () => {})
    expect(readFileSync(join(project, filename), 'utf8')).toBe('approved')
    const restored = createManagedSession({ id: managed.id, permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
    restored.isolatedWorkspace = JSON.parse(readFileSync(join(getSessionPath(workspace.rootPath, managed.id), 'data', 'isolated-workspace.json'), 'utf8'))
    if (pending) {
      // Model a crash after the transaction committed but before delivery confirmation.
      restored.isolatedWorkspace!.pendingDelivery = restored.isolatedWorkspace!.delivery
      delete restored.isolatedWorkspace!.delivery
      restored.isolatedWorkspace!.status = 'candidate'
    }
    writeFileSync(join(restored.isolatedWorkspace!.directory, filename), 'late candidate')
    const restarted = new SessionManager()
    ;(restarted as any).sessions.set(restored.id, restored)
    if (pending) {
      await expect(restarted.finalizeTaskWorkspace(restored.id, { file: filename }, () => {}, () => {
        throw new Error('Upstream input changed')
      })).rejects.toThrow('Upstream input changed')
      expect(restored.isolatedWorkspace!.delivery).toBeUndefined()
    }
    if (pending && !sourceCode) {
      restored.parentSessionId = 'parent'; restored.orchestrationId = 'swarm'; restored.orchestrationStatus = 'need-to-check'
      restored.isolatedWorkspace!.autoDelivery = true
      let delivered: Record<string, unknown> | undefined
      restarted.onSessionComplete(event => { delivered = event.artifacts })
      const dispatch = spyOn(restarted, 'sendMessage').mockRejectedValue(new Error('Recovery must not dispatch a model'))
      await restarted.resumeExecution(restored.id)
      expect(delivered).toEqual(first)
      expect(dispatch).not.toHaveBeenCalled()
      expect(restored.isProcessing).toBe(false)
      dispatch.mockRestore()
    } else expect(await restarted.finalizeTaskWorkspace(restored.id, { file: filename }, () => {})).toEqual(first)
    expect(readFileSync(join(project, filename), 'utf8')).toBe('approved')
    writeFileSync(join(project, filename), 'external edit')
    await expect(restarted.finalizeTaskWorkspace(restored.id, { file: filename }, () => {})).rejects.toThrow('changed before delivery')
    expect(readFileSync(join(project, filename), 'utf8')).toBe('external edit')
    restored.permissionMode = 'safe'
    expect(restarted.hasPreparedTaskDelivery(restored.id)).toBe(true)
    expect(restarted.canAutoResumeTaskDelivery(restored.id)).toBe(false)
    await expect(restarted.finalizeTaskWorkspace(restored.id, { file: filename }, () => {})).rejects.toThrow('authorization')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('workspace preparation retries persistence before permitting execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prepare-delivery-'))
  const workspace = { id: 'prepare-workspace', name: 'Prepare', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project')
  mkdirSync(project, { recursive: true }); writeFileSync(join(project, 'result.txt'), 'base')
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const manager = new SessionManager()
  const managed = createManagedSession({ id: 'prepare', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
  managed.taskRunId = 'run'; managed.taskNodeId = 'node'
  ;(manager as any).sessions.set(managed.id, managed)
  const persist = spyOn(manager as any, 'persistSession').mockImplementation(() => {})
  const flush = spyOn(manager as any, 'flushSession').mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined)
  try {
    await expect(manager.prepareTaskWorkspace(managed.id, project, ['result.txt'])).rejects.toThrow('disk unavailable')
    const directory = managed.isolatedWorkspace!.directory
    const prepared = await manager.prepareTaskWorkspace(managed.id, project, ['result.txt'])
    expect(prepared.directory).toBe(directory)
    const otherProject = join(workspace.rootPath, 'other-project')
    mkdirSync(otherProject)
    await expect(manager.prepareTaskWorkspace(managed.id, otherProject, [])).rejects.toThrow('source changed')
    expect(managed.isolatedWorkspace!.directory).toBe(directory)
    managed.stopRequested = true
    await expect(manager.prepareTaskWorkspace(managed.id, project, ['result.txt'])).rejects.toThrow('no longer current')
    expect(flush).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenCalledTimes(2)
    managed.stopRequested = false
    flush.mockImplementationOnce(async () => { managed.stopRequested = true })
    await expect(manager.prepareTaskWorkspace(managed.id, project, ['result.txt'])).rejects.toThrow('no longer current')

    expect(JSON.parse(readFileSync(join(getSessionPath(workspace.rootPath, managed.id), 'data', 'isolated-workspace.json'), 'utf8')).directory).toBe(directory)
  } finally { lookup.mockRestore(); persist.mockRestore(); flush.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('Swarm workspace persists its declaration and integrates only declared outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'swarm-delivery-'))
  const workspace = { id: 'swarm-workspace', name: 'Swarm', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project')
  mkdirSync(project, { recursive: true }); writeFileSync(join(project, 'result.txt'), 'base')
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const manager = new SessionManager()
  const managed = createManagedSession({ id: 'swarm-child', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
  managed.orchestrationId = 'swarm'; managed.parentSessionId = 'parent'
  ;(manager as any).sessions.set(managed.id, managed)
  const persist = spyOn(manager as any, 'persistSession').mockImplementation(() => {})
  const flush = spyOn(manager as any, 'flushSession').mockResolvedValue(undefined)
  try {
    const attempts = await Promise.allSettled([
      manager.prepareSwarmWorkspace(managed.id, project, ['result.txt'], { result: 'result.txt' }),
      manager.prepareSwarmWorkspace(managed.id, project, ['result.txt'], { result: 'other.txt' }),
    ])
    expect(attempts.map(attempt => attempt.status)).toEqual(['fulfilled', 'rejected'])
    const prepared = (attempts[0] as PromiseFulfilledResult<{ directory: string }>).value
    const saved = JSON.parse(readFileSync(join(getSessionPath(workspace.rootPath, managed.id), 'data', 'isolated-workspace.json'), 'utf8'))
    expect(saved.deliveryContract.outputs).toEqual({ result: 'result.txt' })
    await expect(manager.prepareSwarmWorkspace(managed.id, project, [], { result: 'other.txt' })).rejects.toThrow('contract changed')
    writeFileSync(join(prepared.directory, 'result.txt'), 'candidate')
    await expect(manager.finalizeTaskWorkspace(managed.id, { result: 'other.txt' }, () => {})).rejects.toThrow('outputs changed')
    expect(readFileSync(join(project, 'result.txt'), 'utf8')).toBe('base')
    await manager.finalizeTaskWorkspace(managed.id, { result: 'result.txt' }, () => {})
    expect(readFileSync(join(project, 'result.txt'), 'utf8')).toBe('candidate')
  } finally { lookup.mockRestore(); persist.mockRestore(); flush.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

for (const gitProject of [true, false]) test(`configuration delivery runs project checks and preserves the original (git=${gitProject})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'config-delivery-'))
  const workspace = { id: 'config-workspace', name: 'Config', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project')
  mkdirSync(project, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  if (gitProject) { git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test') }
  writeFileSync(join(project, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
  writeFileSync(join(project, 'check.ts'), `import { readFileSync } from 'node:fs'; const config = JSON.parse(readFileSync('tsconfig.json', 'utf8')); if (config.compilerOptions.strict !== true) process.exit(1);`)
  const original = JSON.stringify({ compilerOptions: { strict: true }, label: 'base' })
  writeFileSync(join(project, 'tsconfig.json'), original)
  if (gitProject) { git('add', '.'); git('commit', '-m', 'base') }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'config-child', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
    managed.isolatedWorkspace = prepareIsolatedWorkspace(project, join(root, 'isolated'), ['package.json', 'check.ts', 'tsconfig.json'])
    ;(manager as any).sessions.set(managed.id, managed)
    const candidate = join(managed.isolatedWorkspace.directory, 'tsconfig.json')
    writeFileSync(candidate, JSON.stringify({ compilerOptions: { strict: false } }))
    await expect(manager.finalizeTaskWorkspace(managed.id, { config: 'tsconfig.json' }, () => {})).rejects.toThrow('failed')
    expect(readFileSync(join(project, 'tsconfig.json'), 'utf8')).toBe(original)
    expect(JSON.parse(readFileSync(candidate, 'utf8')).compilerOptions.strict).toBe(false)
    expect(managed.isolatedWorkspace.delivery).toBeUndefined()
    expect(managed.isolatedWorkspace.deliveryProgress?.phase).toBe('validation-failed')
    const repaired = JSON.stringify({ compilerOptions: { strict: true }, label: 'updated' })
    writeFileSync(candidate, repaired)
    await manager.finalizeTaskWorkspace(managed.id, { config: 'tsconfig.json' }, () => {})
    expect(readFileSync(join(project, 'tsconfig.json'), 'utf8')).toBe(repaired)
    expect(managed.isolatedWorkspace.delivery?.checks.some(check => check.includes('test'))).toBe(true)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
