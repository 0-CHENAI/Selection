import { afterEach, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { newThoughtDocument, newThoughtNode, type WorkbenchRequest, type WorkbenchResult } from '@craft-agent/shared/thought-workbench/types'
import { prepareWorkbenchTaskLink, registerThoughtWorkbench } from './thought-workbench'
import { saveThoughtWithMerge } from '@craft-agent/shared/thought-workbench/save'
import { saveThoughtGeneration } from '@craft-agent/shared/thought-workbench/storage'
import * as workbenchStorage from '@craft-agent/shared/thought-workbench/storage'
import * as sessionMaterials from '@craft-agent/shared/thought-workbench/session-materials'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import type { SessionCompletionEvent } from '../../sessions/SessionManager'
import { saveTaskDocument, loadTaskDocument } from '@craft-agent/shared/tasks/document'
import { taskDir, taskYamlPath } from '@craft-agent/shared/tasks/storage'

const roots: string[] = []
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => { mocks.splice(0).forEach(m => m.mockRestore()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })

function fixture(sessionWorkspace = 'ws', fixedPreviewHash?: string) {
  const root = mkdtempSync(join(tmpdir(), 'thought-rpc-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  let handler: (...args: any[]) => Promise<WorkbenchResult>
  let resolveAnswer: (answer: { text: string; model: string }) => void = () => {}
  let emitPreview: ((text: string) => void) | undefined
  let emitAgentOutput: ((output: { kind: 'process' | 'preview'; text: string }) => void) | undefined
  const deleted: string[] = []
  const cancelled: string[] = []
  const calls: unknown[] = []
  let previewSequence = 0
  const events: Array<{ workspaceId: string; generation: NonNullable<WorkbenchResult['generation']> }> = []
  let completion: ((event: SessionCompletionEvent) => void) | undefined
  let committed = true
  registerThoughtWorkbench({ push(_channel: string, _target: unknown, workspaceId: string, generation: NonNullable<WorkbenchResult['generation']>) { events.push({ workspaceId, generation: structuredClone(generation) }) }, handle(channel: string, fn: typeof handler) { expect(channel).toBe(RPC_CHANNELS.tasks.WORKBENCH); handler = fn } } as unknown as RpcServer, {
    sessionManager: {
      async getSession(id: string) { return { id, workspaceId: sessionWorkspace, messages: [{ id: 'answer', role: 'assistant', content: 'confirmed session answer', timestamp: 1, answerProtocol: 'explicit-v1', answerCommitted: committed }] } },
      onSessionComplete(listener: (event: SessionCompletionEvent) => void) { completion = listener; return () => { completion = undefined } },
      onThoughtOutput(_id: string, listener: (output: { kind: 'process' | 'preview'; text: string }) => void) { emitAgentOutput = listener; return () => { emitAgentOutput = undefined } },
      async sendMessage(_id: string, prompt: string, _attachments?: unknown, _stored?: unknown, options?: unknown) { calls.push({ agentPrompt: prompt, options }) },
      async createSession(_ws: string, options: unknown) { calls.push(options); return { id: 'isolated' } },
      async prepareThoughtAgentInput(_id: string, message: string) { return { context: { systemPrompt: 'platform', messages: [{ role: 'user', content: message, timestamp: 0 }], tools: [] }, model: { id: 'test', api: 'test', provider: 'test', contextWindow: 8192 }, hash: `preview-${++previewSequence}` } },
      async queryThoughtContext(_id: string, input: import('@craft-agent/shared/agent/llm-tool').LLMQueryRequest, onTextDelta?: (text: string) => void) {
        if (input.previewOnly) return { text: '', inputSnapshot: { context: { systemPrompt: input.systemPrompt, messages: [], tools: [] }, model: { id: 'test', api: 'test', provider: 'test', contextWindow: 8192 }, hash: fixedPreviewHash ?? `preview-${++previewSequence}` } }
        calls.push(input); emitPreview = onTextDelta; return new Promise(resolve => { resolveAnswer = resolve })
      },
      async deleteSession(id: string) { deleted.push(id) },
      async discardThoughtPreview(id: string) { deleted.push(id) },
      async cancelProcessing(id: string) { cancelled.push(id) },
    },
  } as unknown as HandlerDeps)
  return { root, calls, deleted, cancelled, events,
    preview: (text: string) => emitPreview?.(text),
    agentOutput: (kind: 'process' | 'preview', text: string) => emitAgentOutput?.({ kind, text }),
    completeAgent: (confirmed: boolean) => { committed = confirmed; completion?.({ sessionId: 'isolated', workspaceId: sessionWorkspace, generation: 1, reason: 'complete', finalMessageId: 'answer', finalText: 'UNVERIFIED_EVENT_TEXT' }) },
    answer: () => resolveAnswer({ text: 'confirmed answer', model: 'test' }), rpc: (request: WorkbenchRequest) => handler!({}, 'ws', request) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

it('keeps identical question input hashes isolated across drafts', async () => {
  const f = fixture('ws', 'same-input-hash')
  const previews = []
  for (const id of ['first-draft', 'second-draft']) {
    workbenchStorage.saveThoughtDocument(f.root, { ...newThoughtDocument(id), nodes: [{ ...newThoughtNode('question'), question: 'Same question' }] }, 0)
    previews.push((await f.rpc({ action: 'compile', id, nodeId: 'question' })).context!)
  }
  for (const context of previews) {
    const generation = (await f.rpc({ action: 'generate', id: context.documentId, nodeId: context.targetId, expectedRevision: context.revision, contextHash: context.hash, inputHash: context.agentInput!.hash })).generation!
    expect(generation.status).toBe('running')
    await f.rpc({ action: 'cancel', generationId: generation.id })
  }
});

it('does not publish source receipts when another save wins during attachment parsing', async () => {
  const f = fixture()
  const document = workbenchStorage.saveThoughtDocument(f.root, newThoughtDocument('draft'), 0)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let sourceId = ''
  mocks.push(spyOn(sessionMaterials, 'attachSessionMaterials').mockImplementation(async (_root, _id, _session, _messages, nodes) => {
    sourceId = nodes[0]!.id
    await waiting
    return nodes
  }))
  const importing = f.rpc({ action: 'importSession', id: document.id, expectedRevision: document.revision, sessionId: 'session' })
  await tick()
  const edited = workbenchStorage.saveThoughtDocument(f.root, { ...document, title: 'Newer edit' }, document.revision)
  release()
  await expect(importing).rejects.toThrow('revision conflict')
  expect(workbenchStorage.readWorkbenchRecord(f.root, document.id, 'source', sourceId)).toBeNull()
  expect(workbenchStorage.loadThoughtDocument(f.root, document.id)).toEqual(edited)
})

it('journals first-save linkage before task publication and recovers without creating sessions', async () => {
  const f = fixture()
  const yaml = 'schema_version: 3\nid: first-save\ntitle: First save\ngoal: Review\nnodes:\n  - id: approve\n    kind: approval\n'
  const document = workbenchStorage.saveThoughtDocument(f.root, { ...newThoughtDocument('draft'), executionYaml: yaml }, 0)
  const baseline = { documentId: document.id, documentRevision: document.revision }
  let journalWasPresent = false
  const saved = saveTaskDocument(f.root, yaml, null, { beforeWrite: prepared => {
    prepareWorkbenchTaskLink(f.root, baseline, yaml, prepared.slug, prepared.etag)
    journalWasPresent = !!workbenchStorage.readWorkbenchRecord(f.root, document.id, 'link', 'pending')
    expect(loadTaskDocument(f.root, prepared.slug)).toBeNull()
  } })
  expect(journalWasPresent).toBe(true)
  expect(() => prepareWorkbenchTaskLink(f.root, baseline, yaml, 'different-task', 'etag')).toThrow('already saved')
  const recovered = (await f.rpc({ action: 'get', id: document.id })).document!
  expect(recovered).toMatchObject({ taskSlug: saved.slug, taskEtag: saved.etag, executionYaml: yaml })
  expect(f.calls).toEqual([])
})

it('keeps an uncommitted first-save intent recoverable and refuses stale creation baselines', async () => {
  const f = fixture()
  const document = workbenchStorage.saveThoughtDocument(f.root, { ...newThoughtDocument('draft'), executionYaml: 'draft' }, 0)
  const baseline = { documentId: document.id, documentRevision: document.revision }
  prepareWorkbenchTaskLink(f.root, baseline, 'draft', 'pending-task', 'etag')
  expect((await f.rpc({ action: 'get', id: document.id })).document).toEqual(document)
  expect(() => prepareWorkbenchTaskLink(f.root, baseline, 'changed', 'pending-task', 'etag')).toThrow('baseline changed')
  expect(f.calls).toEqual([])
})

it('recovers updates only after the expected task write and permits retry after a pre-write failure', async () => {
  const f = fixture()
  const yaml = 'schema_version: 3\nid: update-save\ntitle: Initial\ngoal: Review\nnodes:\n  - id: approve\n    kind: approval\n'
  const original = saveTaskDocument(f.root, yaml, null)
  const editedYaml = yaml.replace('title: Initial', 'title: Updated')
  const document = workbenchStorage.saveThoughtDocument(f.root, { ...newThoughtDocument('draft'), taskSlug: original.slug, taskEtag: original.etag, executionYaml: editedYaml }, 0)
  const baseline = { documentId: document.id, documentRevision: document.revision }
  const prepare = (prepared: ReturnType<typeof saveTaskDocument>) => prepareWorkbenchTaskLink(f.root, baseline, editedYaml, prepared.slug, prepared.etag, original.etag)
  expect(() => saveTaskDocument(f.root, editedYaml, original.etag, { beforeWrite: prepared => { prepare(prepared); throw new Error('simulated write failure') } })).toThrow('simulated write failure')
  expect((await f.rpc({ action: 'get', id: document.id })).document).toEqual(document)
  expect(loadTaskDocument(f.root, original.slug)?.etag).toBe(original.etag)
  const saved = saveTaskDocument(f.root, editedYaml, original.etag, { beforeWrite: prepare })
  expect((await f.rpc({ action: 'get', id: document.id })).document).toMatchObject({ title: 'Updated', taskSlug: original.slug, taskEtag: saved.etag, executionYaml: editedYaml })
  expect(f.calls).toEqual([])
})

for (const version of [1, 2] as const) {
  it(`opens and edits linked thinking without migrating the V${version} task file`, async () => {
    const f = fixture()
    const yaml = `${version === 2 ? 'schema_version: 2\n' : ''}id: legacy\ntitle: Legacy\ngoal: Preserve\nnodes:\n  - id: answer\n    prompt: Keep existing definition\n`
    mkdirSync(taskDir(f.root, 'legacy'), { recursive: true })
    writeFileSync(taskYamlPath(f.root, 'legacy'), yaml)
    const task = loadTaskDocument(f.root, 'legacy')!
    const opened = (await f.rpc({ action: 'save', document: { ...newThoughtDocument(`legacy-${version}`), taskSlug: 'legacy', taskEtag: task.etag, executionYaml: yaml }, expectedRevision: 0 })).document!
    const edited = (await f.rpc({ action: 'save', document: { ...opened, title: 'Thinking only', nodes: [newThoughtNode('note')] }, expectedRevision: opened.revision })).document!
    expect((await f.rpc({ action: 'get', id: edited.id })).document).toEqual(edited)
    expect(readFileSync(taskYamlPath(f.root, 'legacy'), 'utf8')).toBe(yaml)
    expect(loadTaskDocument(f.root, 'legacy')!.sourceVersion).toBe(version)
    expect(existsSync(join(taskDir(f.root, 'legacy'), '.history'))).toBe(false)
    expect(f.calls).toEqual([])
  })
}

it('recovers a durable task association after a failed document write without recreating a task', async () => {
  const f = fixture()
  const document = (await f.rpc({ action: 'save', document: newThoughtDocument('link-recovery'), expectedRevision: 0 })).document!
  const task = saveTaskDocument(f.root, 'schema_version: 3\nid: recovered\ntitle: Recovered\ngoal: Review\nnodes:\n  - id: approve\n    kind: approval\n', null)
  const failed = spyOn(workbenchStorage, 'saveThoughtDocument').mockImplementation(() => { throw new Error('simulated write failure') })
  try {
    await expect(f.rpc({ action: 'save', document: { ...document, taskSlug: task.slug, taskEtag: task.etag, executionYaml: task.yaml }, expectedRevision: document.revision })).rejects.toThrow('simulated write failure')
  } finally { failed.mockRestore() }
  expect(workbenchStorage.loadThoughtDocument(f.root, document.id)?.taskSlug).toBeUndefined()
  const recovered = (await f.rpc({ action: 'get', id: document.id })).document!
  expect(recovered).toMatchObject({ taskSlug: task.slug, taskEtag: task.etag, executionYaml: task.yaml, revision: document.revision + 1 })
  expect((await f.rpc({ action: 'get', id: document.id })).document).toEqual(recovered)
  expect(f.calls).toEqual([])
})

it('does not recover a task link across a changed execution draft', async () => {
  const f = fixture()
  const document = (await f.rpc({ action: 'save', document: newThoughtDocument('link-conflict'), expectedRevision: 0 })).document!
  const task = saveTaskDocument(f.root, 'schema_version: 3\nid: existing\ntitle: Existing\ngoal: Review\nnodes:\n  - id: approve\n    kind: approval\n', null)
  workbenchStorage.writeWorkbenchRecord(f.root, document.id, 'link', 'pending', { status: 'pending', taskSlug: task.slug, taskEtag: task.etag, executionYaml: task.yaml })
  const edited = workbenchStorage.saveThoughtDocument(f.root, { ...document, executionYaml: 'newer draft' }, document.revision)
  await expect(f.rpc({ action: 'get', id: document.id })).rejects.toThrow('recovery conflicts')
  expect(workbenchStorage.loadThoughtDocument(f.root, document.id)).toEqual(edited)
})

it('discovers interrupted replay progress after restart without dispatching remaining nodes', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: newThoughtDocument('draft'), expectedRevision: 0 })).document!
  workbenchStorage.writeWorkbenchRecord(f.root, saved.id, 'replay', 'old-replay', { id: 'old-replay', documentId: saved.id, nodeIds: ['first', 'second'], completedNodeIds: ['first'], status: 'running' })
  const first = await f.rpc({ action: 'replays', id: saved.id })
  expect(first.replays).toEqual([{ id: 'old-replay', documentId: saved.id, nodeIds: ['first', 'second'], completedNodeIds: ['first'], status: 'interrupted' }])
  expect(await f.rpc({ action: 'replays', id: saved.id })).toEqual(first)
  expect(f.calls).toEqual([])
})

it('checks actual task identity and ETag when linking without overwriting an external definition', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: newThoughtDocument('draft'), expectedRevision: 0 })).document!
  await expect(f.rpc({ action: 'save', document: { ...saved, taskSlug: 'missing', taskEtag: 'invented' }, expectedRevision: saved.revision })).rejects.toThrow('reload before linking')
  const task = saveTaskDocument(f.root, 'schema_version: 3\nid: workflow\ntitle: Workflow\ngoal: Review\nnodes:\n  - id: approve\n    kind: approval\n', null)
  const linked = (await f.rpc({ action: 'save', document: { ...saved, taskSlug: task.slug, taskEtag: task.etag }, expectedRevision: saved.revision })).document!
  await expect(f.rpc({ action: 'save', document: { ...linked, taskSlug: 'other' }, expectedRevision: linked.revision })).rejects.toThrow('cannot change task identity')
  await expect(f.rpc({ action: 'save', document: { ...linked, taskEtag: 'stale' }, expectedRevision: linked.revision })).rejects.toThrow('reload before linking')
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.taskEtag).toBe(task.etag)
})

it('rejects forged execution versions carried by a newly added node', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: newThoughtDocument('draft'), expectedRevision: 0 })).document!
  const forged = { ...newThoughtNode('forged'), answer: 'fabricated execution', activeVersionId: 'receipt', versions: [{ id: 'receipt', question: 'question', answer: 'fabricated execution', contextHash: 'fake', model: 'model', createdAt: new Date().toISOString(), status: 'completed' as const }] }
  await expect(f.rpc({ action: 'save', document: { ...saved, nodes: [forged] }, expectedRevision: saved.revision })).rejects.toThrow('versions are read-only')
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.nodes).toEqual([])
  await expect(f.rpc({ action: 'save', document: { ...newThoughtDocument('new-draft'), nodes: [forged] }, expectedRevision: 0 })).rejects.toThrow('versions are read-only')
})

it('persists the delivered answer before committing the graph version', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('durable-answer'), nodes: [{ ...newThoughtNode('question'), question: 'Question' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  const original = workbenchStorage.saveThoughtDocument
  let checked = false
  const observer = spyOn(workbenchStorage, 'saveThoughtDocument').mockImplementation((root, document, revision) => {
    const snapshot = workbenchStorage.ThoughtDocumentSchema.parse(document)
    if (snapshot.id === saved.id && snapshot.nodes[0]?.versions.length) {
      expect(workbenchStorage.loadThoughtGeneration(root, generation.id)).toMatchObject({ answer: 'confirmed answer', status: 'running' })
      checked = true
    }
    return original(root, document, revision)
  })
  mocks.push(observer)
  f.answer()
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  expect(checked).toBe(true)
  expect(f.events.map(event => event.generation.sequence)).toEqual([1, 2, 3])
  expect(f.events.map(event => event.generation.status)).toEqual(['running', 'running', 'completed'])
  expect(f.events.every(event => event.workspaceId === 'ws' && event.generation.id === generation.id)).toBe(true)
  expect(workbenchStorage.loadThoughtGeneration(f.root, generation.id)).toEqual(f.events.at(-1)!.generation)
})

it('commits Agent answers from the authoritative confirmed message rather than event text', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('agent-draft'), nodes: [{ ...newThoughtNode('question'), mode: 'agent', question: 'Agent question' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  f.agentOutput('process', 'Tool work in progress')
  expect(f.calls.find(call => call !== null && typeof call === 'object' && 'agentPrompt' in call)).toMatchObject({ options: { strictInput: true } })
  f.agentOutput('preview', 'First draft')
  f.agentOutput('preview', 'Revised draft')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation).toMatchObject({ processText: 'Tool work in progress', preview: 'Revised draft' })
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!.versions).toEqual([])
  f.completeAgent(true)
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.mode).toBe('agent')
  const node = (await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!
  expect(node.answer).toBe('confirmed session answer')
  expect(node.versions[0]?.sessionId).toBe('isolated')
  expect(f.deleted).toEqual([])
  f.agentOutput('preview', 'late preview')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.preview).toBeUndefined()
})

it('requires the latest Agent preview and reuses its session only after explicit generation', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('preview-owner'), nodes: [{ ...newThoughtNode('question'), mode: 'agent', question: 'Graph input' }] }, expectedRevision: 0 })).document!
  const first = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const second = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  expect(second.agentInput?.context.systemPrompt).toBe('platform')
  expect(f.calls).toHaveLength(2) // session creation only, no model or TaskRunner call
  expect(f.deleted).toEqual(['isolated'])
  const request = { action: 'generate' as const, id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: second.hash }
  await expect(f.rpc({ ...request, inputHash: first.agentInput!.hash })).rejects.toThrow('preview expired or changed')
  await expect(f.rpc(request)).rejects.toThrow('preview expired or changed')
  expect(f.calls).toHaveLength(2)
  const generation = (await f.rpc({ ...request, inputHash: second.agentInput!.hash })).generation!
  expect(f.calls).toHaveLength(3)
  expect(f.calls[2]).toMatchObject({ agentPrompt: second.prompt, options: { strictInput: true, inputHash: second.agentInput!.hash } })
  f.completeAgent(true)
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  const completed = (await f.rpc({ action: 'get', id: saved.id })).document!
  await expect(f.rpc({ ...request, expectedRevision: completed.revision, inputHash: second.agentInput!.hash })).rejects.toThrow('preview expired or changed')
})

it('fails Agent generation without activating an uncommitted answer', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('agent-draft'), nodes: [{ ...newThoughtNode('question'), mode: 'agent', question: 'Agent question' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  f.completeAgent(false)
  expect(await waitForGeneration(f, generation.id)).toMatchObject({ status: 'failed', error: 'Agent completed without a confirmed answer' })
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!.versions).toEqual([])
  expect(f.deleted).toEqual([])
})

it('discovers interrupted receipts after restart without rerunning their tools', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [newThoughtNode('question')] }, expectedRevision: 0 })).document!
  saveThoughtGeneration(f.root, { id: 'old-generation', documentId: saved.id, nodeId: 'question', sessionId: 'agent-session', contextHash: 'old-input', status: 'running', answer: 'Delivered before restart' })
  const first = (await f.rpc({ action: 'generations', id: saved.id })).generations!
  expect(first).toHaveLength(1)
  expect(first[0]).toMatchObject({ id: 'old-generation', status: 'interrupted', sessionId: 'agent-session', answer: 'Delivered before restart' })
  expect((await f.rpc({ action: 'generations', id: saved.id })).generations).toEqual(first)
  expect(f.calls).toEqual([])
})

it('does not mark a live generation interrupted when discovering receipts', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'input' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  expect((await f.rpc({ action: 'generations', id: saved.id })).generations?.[0]).toMatchObject({ id: generation.id, status: 'running' })
  await f.rpc({ action: 'cancel', generationId: generation.id })
  f.answer(); await tick()
})

async function waitForGeneration(f: ReturnType<typeof fixture>, generationId: string) {
  for (let i = 0; i < 100; i++) {
    const generation = (await f.rpc({ action: 'generation', generationId })).generation!
    if (generation.status !== 'running') return generation
    await tick()
  }
  throw new Error('Generation did not finish')
}

it('keeps the immutable model input while saving an edited question during generation', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'ORIGINAL_MARKER', model: 'test' }] }
  const saved = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  await f.rpc({ action: 'save', expectedRevision: saved.revision, document: { ...saved, nodes: [{ ...saved.nodes[0]!, question: 'EDITED_MARKER' }] } })
  f.answer()
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  const result = (await f.rpc({ action: 'get', id: saved.id })).document!
  expect(f.calls[1]).toMatchObject({ prompt: 'ORIGINAL_MARKER' })
  expect(result.nodes[0]).toMatchObject({ question: 'EDITED_MARKER', answer: '' })
  expect(result.nodes[0]!.activeVersionId).toBeUndefined()
  expect(result.nodes[0]!.versions).toHaveLength(1)
  expect(result.nodes[0]!.versions[0]).toMatchObject({ question: 'ORIGINAL_MARKER', answer: 'confirmed answer', contextHash: context.hash })
})

it('activates an answer after layout-only edits without losing the saved layout', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'input' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  await f.rpc({ action: 'save', expectedRevision: saved.revision, document: { ...saved, nodes: [{ ...saved.nodes[0]!, position: { x: 450, y: -120 } }] } })
  f.answer()
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  const result = (await f.rpc({ action: 'get', id: saved.id })).document!
  expect(result.nodes[0]).toMatchObject({ answer: 'confirmed answer', activeVersionId: generation.id, position: { x: 450, y: -120 } })
})

it('replays selected dependencies serially and compiles downstream input after the prior answer', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: ['a', 'b'].map(id => ({ ...newThoughtNode(id), question: id })),
    edges: [{ id: 'ab', source: 'a', target: 'b', kind: 'context' as const, depth: 'full' as const, order: 0 }] }
  const saved = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const replay = (await f.rpc({ action: 'startReplay', id: saved.id, expectedRevision: saved.revision, nodeIds: ['b', 'a'] })).replay!
  for (let i = 0; i < 100 && f.calls.length < 2; i++) await tick()
  expect(f.calls).toHaveLength(2)
  f.answer(); for (let i = 0; i < 100 && f.calls.length < 4; i++) await tick()
  expect(f.calls[3]).toMatchObject({ prompt: 'b', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'confirmed answer' }] })
  f.answer()
  for (let i = 0; i < 100; i++) {
    if ((await f.rpc({ action: 'replay', id: saved.id, replayId: replay.id })).replay?.status !== 'running') break
    await tick()
  }
  expect((await f.rpc({ action: 'replay', id: saved.id, replayId: replay.id })).replay).toMatchObject({ status: 'completed', completedNodeIds: ['a', 'b'] })
})

it('records manual revisions without model execution and rejects stale revisions', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'question' }] }
  const saved = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const first = (await f.rpc({ action: 'reviseAnswer', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, answer: 'first edit' })).document!
  const second = (await f.rpc({ action: 'reviseAnswer', id: saved.id, nodeId: 'question', expectedRevision: first.revision, answer: 'second edit' })).document!
  expect(second.nodes[0]!.versions.map(v => [v.origin, v.answer])).toEqual([['manual', 'first edit'], ['manual', 'second edit']])
  expect(second.nodes[0]!.activeVersionId).toBe(second.nodes[0]!.versions[1]!.id)
  expect(f.calls).toEqual([])
  await expect(f.rpc({ action: 'reviseAnswer', id: saved.id, nodeId: 'question', expectedRevision: first.revision, answer: 'stale edit' })).rejects.toThrow('revision conflict')
})

it('rejects ordinary saves that rewrite or erase existing answer versions', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'input' }] }, expectedRevision: 0 })).document!
  const revised = (await f.rpc({ action: 'reviseAnswer', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, answer: 'confirmed' })).document!
  for (const versions of [[], revised.nodes[0]!.versions.map(version => ({ ...version, answer: 'forged' }))]) {
    await expect(f.rpc({ action: 'save', expectedRevision: revised.revision, document: { ...revised, nodes: [{ ...revised.nodes[0]!, activeVersionId: undefined, answer: '', versions }] } })).rejects.toThrow('versions are read-only')
  }
  const renamed = (await f.rpc({ action: 'save', expectedRevision: revised.revision, document: { ...revised, title: 'Renamed' } })).document!
  expect(renamed.nodes[0]!.versions).toEqual(revised.nodes[0]!.versions)
})

it('rebases a stale client save after an answer version is committed', async () => {
  const f = fixture()
  const base = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'input' }] }, expectedRevision: 0 })).document!
  const revised = (await f.rpc({ action: 'reviseAnswer', id: base.id, nodeId: 'question', expectedRevision: base.revision, answer: 'confirmed' })).document!
  const saved = await saveThoughtWithMerge({ base, local: { ...base, title: 'Edited during delivery' },
    load: async () => (await f.rpc({ action: 'get', id: base.id })).document!,
    write: async document => (await f.rpc({ action: 'save', document, expectedRevision: document.revision })).document!,
  })
  expect(saved.title).toBe('Edited during delivery')
  expect(saved.nodes[0]!.versions).toEqual(revised.nodes[0]!.versions)
  expect(saved.nodes[0]!.answer).toBe('confirmed')
})

it('permits selecting an old answer but rejects forged active content and duplicate receipts', async () => {
  const f = fixture()
  const base = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'input' }] }, expectedRevision: 0 })).document!
  const first = (await f.rpc({ action: 'reviseAnswer', id: base.id, nodeId: 'question', expectedRevision: base.revision, answer: 'first' })).document!
  const second = (await f.rpc({ action: 'reviseAnswer', id: base.id, nodeId: 'question', expectedRevision: first.revision, answer: 'second' })).document!
  const node = second.nodes[0]!
  for (const changed of [
    { ...node, answer: 'forged' },
    { ...node, activeVersionId: 'missing' },
    { ...node, answer: 'first', activeVersionId: first.nodes[0]!.activeVersionId, versions: [node.versions[0]!, node.versions[0]!] },
  ]) await expect(f.rpc({ action: 'save', document: { ...second, nodes: [changed] }, expectedRevision: second.revision })).rejects.toThrow()
  const selected = (await f.rpc({ action: 'save', document: { ...second, nodes: [{ ...node, answer: 'first', activeVersionId: first.nodes[0]!.activeVersionId }] }, expectedRevision: second.revision })).document!
  expect(selected.nodes[0]!.answer).toBe('first')
  expect(selected.nodes[0]!.versions).toEqual(node.versions)
})

it('records a tool-free isolated answer as a version without creating a task', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'unique input', model: 'test' }] }
  const saved = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  expect(f.calls[0]).toMatchObject({ permissionMode: 'safe', taskDraft: true })
  expect(generation.mode).toBe('question')
  expect(f.calls[1]).toMatchObject({ prompt: 'unique input', messages: [], strictInput: true })
  f.preview('unconfirmed preview')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.preview).toBe('unconfirmed preview')
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!.versions).toEqual([])
  f.answer(); await tick()
  expect((await waitForGeneration(f, generation.id)).status).toBe('completed')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.preview).toBeUndefined()
  const node = (await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!
  expect(node.answer).toBe('confirmed answer')
  expect(node.versions[0]?.contextHash).toBe(context.hash)
  expect(f.deleted).toEqual(['isolated'])
  expect(readdirSync(f.root)).toEqual(['thought-workbenches'])
})

it('does not accept an answer arriving after cancellation', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'Answer this' }] }
  const saved = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  await f.rpc({ action: 'cancel', generationId: generation.id }); f.preview('late preview'); f.answer(); await tick()
  await f.rpc({ action: 'cancel', generationId: generation.id })
  expect(f.cancelled).toEqual(['isolated'])
  expect(f.deleted).toEqual(['isolated'])
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.status).toBe('interrupted')
  expect((await f.rpc({ action: 'generation', generationId: generation.id })).generation?.preview).toBeUndefined()
  expect((await f.rpc({ action: 'get', id: saved.id })).document!.nodes[0]!.versions).toEqual([])
})

it('flushes trailing preview text while the model is idle and stops publishing after cancellation', async () => {
  const f = fixture()
  const saved = (await f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'Stream a response' }] }, expectedRevision: 0 })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  const generation = (await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })).generation!
  f.preview('first')
  f.preview(' trailing')
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(workbenchStorage.loadThoughtGeneration(f.root, generation.id)?.preview).toBe('first trailing')
  expect(f.events.at(-1)?.generation.preview).toBe('first trailing')
  await f.rpc({ action: 'cancel', generationId: generation.id })
  f.answer()
  await tick()
  const count = f.events.length
  f.preview('late')
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(f.events).toHaveLength(count)
  expect(workbenchStorage.loadThoughtGeneration(f.root, generation.id)?.preview).toBe('first trailing')
})

it('rejects stale preview before creating a model session', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [newThoughtNode('question')] }
  await f.rpc({ action: 'save', document, expectedRevision: 0 })
  await expect(f.rpc({ action: 'generate', id: document.id, nodeId: 'question', expectedRevision: 0, contextHash: 'old' })).rejects.toThrow('changed')
  expect(f.calls).toEqual([])
})

it('rejects a forged proposal application recovery marker', async () => {
  const f = fixture()
  await expect(f.rpc({ action: 'save', document: { ...newThoughtDocument('draft'), lastAppliedProposalId: 'forged' }, expectedRevision: 0 })).rejects.toThrow('read-only')
})

it('imports completed session content, protects it and permits undo of a graph removal', async () => {
  const f = fixture()
  const first = (await f.rpc({ action: 'save', document: newThoughtDocument('draft'), expectedRevision: 0 })).document!
  const imported = (await f.rpc({ action: 'importSession', id: first.id, expectedRevision: first.revision, sessionId: 'source' })).document!
  expect(imported.nodes[0]?.source?.messageId).toBe('answer')
  await expect(f.rpc({ action: 'save', document: { ...imported, nodes: imported.nodes.map(node => ({ ...node, answer: 'forged' })) }, expectedRevision: imported.revision })).rejects.toThrow('read-only')
  const removed = (await f.rpc({ action: 'save', document: { ...imported, nodes: [] }, expectedRevision: imported.revision })).document!
  const restored = (await f.rpc({ action: 'save', document: { ...removed, nodes: imported.nodes }, expectedRevision: removed.revision })).document!
  expect(restored.nodes[0]?.answer).toBe('confirmed session answer')
})

it('does not copy a session from a different workspace', async () => {
  const f = fixture('foreign')
  const document = (await f.rpc({ action: 'save', document: newThoughtDocument('draft'), expectedRevision: 0 })).document!
  await expect(f.rpc({ action: 'importSession', id: document.id, expectedRevision: document.revision, sessionId: 'source' })).rejects.toThrow('Unknown session')
  expect((await f.rpc({ action: 'get', id: document.id })).document!.nodes).toEqual([])
})

it('sends verified original image bytes with the exact previewed prompt', async () => {
  const f = fixture()
  const document = { ...newThoughtDocument('draft'), nodes: [{ ...newThoughtNode('question'), question: 'Describe this image', model: 'test' }] }
  const first = (await f.rpc({ action: 'save', document, expectedRevision: 0 })).document!
  const base64 = Buffer.from('image fixture bytes').toString('base64')
  const saved = (await f.rpc({ action: 'importMaterial', id: first.id, expectedRevision: first.revision, nodeId: 'question', name: 'pixel.png', mimeType: 'image/png', base64, text: '' })).document!
  const context = (await f.rpc({ action: 'compile', id: saved.id, nodeId: 'question' })).context!
  await f.rpc({ action: 'generate', id: saved.id, nodeId: 'question', expectedRevision: saved.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })
  expect(f.calls[1]).toMatchObject({ prompt: context.prompt, systemPrompt: context.systemPrompt, strictInput: true, images: [{ mimeType: 'image/png', data: base64 }] })
  f.answer(); await tick()
})
