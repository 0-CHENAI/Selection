import { expect, test, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, realpathSync, readdirSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { SessionManager, createManagedSession } from './SessionManager'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { FeedbackStore } from '../reliability/feedback-store'

for (const revoked of ['parent', 'child'] as const) test(`text feedback cannot apply after ${revoked} write authorization is revoked`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-permission-'))
  const workspace = { id: 'feedback-workspace', name: 'Feedback', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const file = join(workspace.rootPath, 'result.txt'); writeFileSync(file, 'original')
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const manager = new SessionManager(), internal = manager as any
    const parent = createManagedSession({ id: 'parent', permissionMode: 'allow-all', workingDirectory: workspace.rootPath }, workspace as never, { messagesLoaded: true })
    const child = createManagedSession({ id: 'revision', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
    internal.sessions.set(parent.id, parent); internal.sessions.set(child.id, child)
    internal.persistSession = () => {}; internal.flushSession = async () => {}
    internal.createSession = async () => ({ id: child.id })
    manager.sendMessage = async () => {
      writeFileSync(join(child.workingDirectory!, 'result.txt'), 'approved')
      ;(revoked === 'parent' ? parent : child).permissionMode = 'safe'
    }
    const versions = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const initial = versions.register(file)
    const feedback = await manager.artifactFeedback({ type: 'create', sessionId: parent.id, requestId: 'revision-request', artifactId: initial.id, baseVersion: initial.currentVersion, instruction: 'revise text' })
    const store = new FeedbackStore(join(workspace.rootPath, 'artifacts', 'feedback'))
    for (let i = 0; i < 500 && internal.activeArtifactFeedback.has(feedback.id); i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(store.read(feedback.id).status).toBe('failed')
    expect(store.read(feedback.id).error).toContain('write authorization')
    expect(readFileSync(file, 'utf8')).toBe('original')
    expect(versions.read(initial.id).versions).toHaveLength(1)
    expect(readFileSync(join(child.workingDirectory!, 'result.txt'), 'utf8')).toBe('approved')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

for (const gitProject of [true, false]) for (const mode of (gitProject ? ['pass', 'fail', 'external', 'cancel'] : ['pass', 'fail', 'external', 'cancel', 'missing', 'receipt-failure', 'remote-cancel', 'corrupt-state']) as readonly string[]) test(`code feedback validates and preserves versions (${mode}, git=${gitProject})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-code-'))
  const workspace = { id: 'feedback-workspace', name: 'Feedback', rootPath: join(root, 'workspace') }
  const project = join(workspace.rootPath, 'project'); mkdirSync(project, { recursive: true })
  const file = join(project, 'result.ts')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  if (gitProject) { git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test') }
  writeFileSync(file, 'original')
  writeFileSync(join(project, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'bun run check.ts' } }))
  writeFileSync(join(project, 'check.ts'), `import { readFileSync, writeFileSync } from 'node:fs'; if (readFileSync('result.ts','utf8') !== 'approved') process.exit(1); ${['remote-cancel', 'corrupt-state'].includes(mode) ? `writeFileSync('validation-running', 'ready');` : ''} ${(mode.endsWith('cancel') || mode === 'corrupt-state') ? 'await new Promise(resolve => setTimeout(resolve, 30000));' : ''}`)
  if (gitProject) { git('add', '.'); git('commit', '-m', 'base') }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const save = FeedbackStore.prototype.save
  let receiptFailed = false
  const receiptFault = spyOn(FeedbackStore.prototype, 'save').mockImplementation(function(this: FeedbackStore, record, apply) {
    if (mode === 'receipt-failure' && apply && !receiptFailed) {
      return save.call(this, record, () => { apply(); receiptFailed = true; throw new Error('feedback receipt disk failure') })
    }
    return save.call(this, record, apply)
  })
  const succeeds = mode === 'pass' || mode === 'receipt-failure'
  try {
    const manager = new SessionManager(), internal = manager as any
    const appliedWorkspaces: string[] = []
    manager.onArtifactApplied(workspaceId => { appliedWorkspaces.push(workspaceId) })
    const parent = createManagedSession({ id: 'parent', permissionMode: 'allow-all', workingDirectory: project }, workspace as never, { messagesLoaded: true })
    internal.sessions.set(parent.id, parent)
    internal.persistSession = () => {}; internal.flushSession = async () => {}
    internal.createSession = async () => {
      const child = createManagedSession({ id: 'revision', permissionMode: 'allow-all' }, workspace as never, { messagesLoaded: true })
      internal.sessions.set(child.id, child); return { id: child.id }
    }
    // Model output is deterministic here; storage, validation subprocesses and apply are real.
    manager.sendMessage = async id => {
      const child = internal.sessions.get(id)
      writeFileSync(join(child.workingDirectory, 'result.ts'), mode === 'fail' ? 'rejected' : 'approved')
      if (mode === 'external') writeFileSync(file, 'user edit')
    }
    const versions = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const initial = versions.register(file)
    expect(await manager.getArtifactFeedbackContext(parent.id, initial.id)).toEqual({ root: realpathSync(project), requiresProjectChecks: true })
    await expect(manager.artifactFeedback({ type: 'create', sessionId: parent.id, requestId: 'wrong-root', artifactId: initial.id, baseVersion: initial.currentVersion, instruction: 'revise code', validationRoot: join(root, 'other-project'), validationInputs: ['package.json'] })).rejects.toThrow('project changed')
    const feedback = await manager.artifactFeedback({ type: 'create', sessionId: parent.id, requestId: 'revision-request', artifactId: initial.id, baseVersion: initial.currentVersion, instruction: 'revise code', validationInputs: gitProject ? undefined : ['package.json', 'result.ts', ...(mode === 'missing' ? [] : ['check.ts'])] })
    const store = new FeedbackStore(join(workspace.rootPath, 'artifacts', 'feedback'))
    const validationStarted = () => {
      const candidates = join(root, '.project-validation', 'candidates')
      return existsSync(candidates) && readdirSync(candidates).some(id => {
        const metadata = join(candidates, id, 'workspace.json')
        return existsSync(metadata) && existsSync(join(JSON.parse(readFileSync(metadata, 'utf8')).directory, 'validation-running'))
      })
    }
    let current = store.read(feedback.id)
    for (let i = 0; i < 500 && ['queued', 'running', 'validating'].includes(current.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 10)); current = store.read(feedback.id)
      if (mode === 'corrupt-state' && validationStarted()) {
        writeFileSync(join(workspace.rootPath, 'artifacts', 'feedback', `${feedback.id}.json`), '{invalid')
        break
      }
      if (mode.endsWith('cancel') && internal.projectValidationControllers.has('revision') && (mode !== 'remote-cancel' || validationStarted())) {
        if (mode === 'remote-cancel') { const remote = store.read(feedback.id); remote.status = 'cancelled'; store.save(remote) }
        else await manager.artifactFeedback({ type: 'cancel', sessionId: parent.id, feedbackId: feedback.id })
        current = store.read(feedback.id)
      }
    }
    if (mode === 'corrupt-state') {
      for (let i = 0; i < 100 && internal.activeArtifactFeedback.has(feedback.id); i++) await new Promise(resolve => setTimeout(resolve, 10))
      expect(internal.activeArtifactFeedback.has(feedback.id)).toBe(false)
      expect(internal.projectValidationControllers.has('revision')).toBe(false)
      expect(readFileSync(file, 'utf8')).toBe('original')
      expect(versions.read(initial.id).versions).toHaveLength(1)
      expect(appliedWorkspaces).toEqual([])
      expect(() => store.read(feedback.id)).toThrow()
      return
    }
    expect(appliedWorkspaces).toEqual(succeeds ? [workspace.id] : [])
    expect(current.status).toBe(succeeds ? 'applied' : (mode === 'fail' || mode === 'missing') ? 'failed' : mode.endsWith('cancel') ? 'cancelled' : 'conflict')
    expect(readFileSync(file, 'utf8')).toBe(succeeds ? 'approved' : mode === 'external' ? 'user edit' : 'original')
    expect(versions.read(initial.id).versions).toHaveLength(succeeds ? 2 : 1)
    if (mode.endsWith('cancel')) {
      for (let i = 0; i < 100 && internal.activeArtifactFeedback.has(feedback.id); i++) await new Promise(resolve => setTimeout(resolve, 10))
      expect(internal.activeArtifactFeedback.has(feedback.id)).toBe(false)
      expect(store.read(feedback.id).status).toBe('cancelled')
    }
    expect(versions.protectedVersionIds(initial.id)).toContain(initial.currentVersion)
    if (succeeds) {
      await manager.artifactFeedback({ type: 'resolve', sessionId: parent.id, feedbackId: feedback.id })
      expect(versions.protectedVersionIds(initial.id)).not.toContain(initial.currentVersion)
    }
    expect(versions.versionBytes(initial.id, initial.currentVersion).toString()).toBe('original')
    if (!mode.endsWith('cancel')) expect(current.validation?.some(check => check.includes((mode === 'fail' || mode === 'missing') ? 'failed' : 'passed'))).toBe(true)
    if (mode === 'receipt-failure') expect(receiptFailed).toBe(true)
  } finally { receiptFault.mockRestore(); lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
