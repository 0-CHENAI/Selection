import { randomUUID } from 'node:crypto'
import { attachSessionMaterials } from '@craft-agent/shared/thought-workbench/session-materials'
import { z } from 'zod'
import { loadTaskDocument } from '@craft-agent/shared/tasks/document'
import { commitThoughtAnswer } from '@craft-agent/shared/thought-workbench/answer'
import { listThoughtGenerations, listWorkbenchRecords } from '@craft-agent/shared/thought-workbench/storage'
import { exportWorkbenchBundle, importWorkbenchBundle } from '@craft-agent/shared/thought-workbench/bundle'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createLogger } from '@craft-agent/shared/utils'
import { importWorkbenchMaterial, readWorkbenchMaterial, quoteWorkbenchMaterial } from '@craft-agent/shared/thought-workbench/materials'
import { executionNodeSources, listWorkbenchProposals, applyWorkbenchProposal, discardWorkbenchProposal } from '@craft-agent/shared/thought-workbench/proposals'
import { committedGenerationAnswer, appendSessionSources, sessionSourceNodes, importTaskResult, assertSourceNodesUnchanged, recordSourceSnapshots, sourceReceipts } from '@craft-agent/shared/thought-workbench/sources'
import { compileThoughtContext, thoughtReplayOrder, validateThoughtGraph } from '@craft-agent/shared/thought-workbench/context'
import { readWorkbenchRecord, writeWorkbenchRecord, ThoughtReplaySchema } from '@craft-agent/shared/thought-workbench/storage'
import { runThoughtReplay } from './thought-replay'
import { loadThoughtDocument, saveThoughtDocument, listThoughtDocuments, saveThoughtGeneration, loadThoughtGeneration, ThoughtDocumentSchema } from '@craft-agent/shared/thought-workbench/storage'
import type { WorkbenchRequest, WorkbenchResult, ThoughtGeneration } from '@craft-agent/shared/thought-workbench/types'
import { pushTyped, type RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

const linkIntentSchema = z.object({
  status: z.enum(['pending', 'applied']), taskSlug: z.string(), taskEtag: z.string(),
  executionYaml: z.string().optional(), beforeTaskSlug: z.string().optional(),
  beforeTaskEtag: z.string().optional(), beforeExecutionYaml: z.string().optional(),
  allowMissing: z.boolean().optional(),
  prepared: z.boolean().optional(),
}).strict()

/** Called synchronously before the task's normalized bytes are atomically published. */
export function prepareWorkbenchTaskLink(root: string, baseline: { documentId: string; documentRevision: number }, yaml: string, taskSlug: string, taskEtag: string, expectedEtag?: string): void {
  const document = loadThoughtDocument(root, baseline.documentId)
  if (!document || !Number.isSafeInteger(baseline.documentRevision) || document.revision !== baseline.documentRevision || document.executionYaml !== yaml) throw new Error('Workbench creation baseline changed; save the draft again')
  if (expectedEtag === undefined && document.taskSlug) throw new Error('Workbench already has a task; edit that task instead')
  if (expectedEtag !== undefined && (document.taskSlug !== taskSlug || document.taskEtag !== expectedEtag)) throw new Error('Workbench task association changed; reload before saving')
  const previous = readWorkbenchRecord(root, document.id, 'link', 'pending')
  if (previous) {
    const intent = linkIntentSchema.parse(previous)
    const task = loadTaskDocument(root, intent.taskSlug)
    if (intent.status === 'pending' && task && !(intent.prepared && task.etag === intent.beforeTaskEtag)) throw new Error('Workbench task was already saved; reopen the draft to recover its association')
  }
  writeWorkbenchRecord(root, document.id, 'link', 'pending', {
    status: 'pending', prepared: true, allowMissing: expectedEtag === undefined, taskSlug, taskEtag, executionYaml: yaml,
    beforeTaskSlug: document.taskSlug, beforeTaskEtag: document.taskEtag, beforeExecutionYaml: document.executionYaml,
  })
}

/** Repairs only the association after a partial save, never the task definition. */
function recoverTaskLink(root: string, id: string) {
  const document = loadThoughtDocument(root, id)
  if (!document) return null
  const record = readWorkbenchRecord(root, id, 'link', 'pending')
  if (!record) return document
  const intent = linkIntentSchema.parse(record)
  if (intent.status === 'applied') return document
  if (document.taskSlug === intent.taskSlug && document.taskEtag === intent.taskEtag) {
    writeWorkbenchRecord(root, id, 'link', 'pending', { ...intent, status: 'applied' })
    return document
  }
  const task = loadTaskDocument(root, intent.taskSlug)
  if (!task && intent.allowMissing) return document
  if (intent.prepared && task?.etag === intent.beforeTaskEtag && document.taskSlug === intent.beforeTaskSlug
    && document.taskEtag === intent.beforeTaskEtag && document.executionYaml === intent.beforeExecutionYaml) return document
  if (!task || task.etag !== intent.taskEtag || document.taskSlug !== intent.beforeTaskSlug
    || document.taskEtag !== intent.beforeTaskEtag || document.executionYaml !== intent.beforeExecutionYaml) {
    throw new Error('Task linkage recovery conflicts with a newer definition; reload and explicitly save the desired task association')
  }
  const saved = saveThoughtDocument(root, { ...document, title: task.spec?.title ?? document.title, projectId: task.spec ? task.spec.project : document.projectId, taskSlug: intent.taskSlug, taskEtag: intent.taskEtag, executionYaml: intent.executionYaml }, document.revision)
  writeWorkbenchRecord(root, id, 'link', 'pending', { ...intent, status: 'applied' })
  return saved
}

/** Generation inputs are immutable snapshots; editor writes cannot change an in-flight request. */
export function registerThoughtWorkbench(server: RpcServer, deps: HandlerDeps): void {
  const log = createLogger('thought-workbench')
  const jobs = new Map<string, { workspaceId: string; generation: ThoughtGeneration; finished: Promise<ThoughtGeneration>; cancel: () => Promise<void> }>()
  const replays = new Map<string, { workspaceId: string; controller: ReturnType<typeof runThoughtReplay> }>()
  const starting = new Set<string>()
  const previews = new Map<string, { key: string; revision: number; contextHash: string; sessionId: string; snapshot: import('@craft-agent/shared/agent/pi-turn-input').AgentInputSnapshot; timer: ReturnType<typeof setTimeout> }>()
  const discardPreview = async (hash: string) => {
    const preview = previews.get(hash)
    if (!preview) return
    previews.delete(hash)
    clearTimeout(preview.timer)
    await deps.sessionManager.discardThoughtPreview(preview.sessionId)
  }
  const handle = async (_ctx: unknown, workspaceId: string, request: WorkbenchRequest): Promise<WorkbenchResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Unknown workspace')
    if (!request || typeof request !== 'object') throw new Error('Invalid workbench request')
    const publishGeneration = (generation: ThoughtGeneration, context?: Parameters<typeof saveThoughtGeneration>[2]) => {
      const next = { ...generation, sequence: (generation.sequence ?? 0) + 1 }
      saveThoughtGeneration(workspace.rootPath, next, context)
      generation.sequence = next.sequence
      // Persist before publishing. Transport failure must not invalidate the
      // committed answer; reconnecting clients recover the same receipt by RPC.
      try { pushTyped(server, RPC_CHANNELS.tasks.WORKBENCH_GENERATION, { to: 'workspace', workspaceId }, workspaceId, next) }
      catch (error) { log.error('Cannot publish workbench generation', error) }
    }
    if (request.action === 'replays') {
      const records = listWorkbenchRecords(workspace.rootPath, request.id, 'replay').map(value => ThoughtReplaySchema.parse(value))
      for (const replay of records) {
        if (replay.documentId !== request.id) throw new Error('Replay identity mismatch')
        const live = replays.get(replay.id)
        if (replay.status === 'running' && (!live || live.workspaceId !== workspaceId || live.controller.replay.documentId !== request.id)) {
          replay.status = 'interrupted'
          writeWorkbenchRecord(workspace.rootPath, request.id, 'replay', replay.id, replay)
        }
      }
      return { replays: records }
    }
    if (request.action === 'replay' || request.action === 'cancelReplay') {
      const entry = replays.get(request.replayId)
      if (entry) {
        if (entry.workspaceId !== workspaceId || entry.controller.replay.documentId !== request.id) throw new Error('Unknown replay')
        if (request.action === 'cancelReplay') await entry.controller.cancel()
        return { replay: entry.controller.replay }
      }
      const replay = ThoughtReplaySchema.parse(readWorkbenchRecord(workspace.rootPath, request.id, 'replay', request.replayId))
      if (replay.id !== request.replayId || replay.documentId !== request.id) throw new Error('Replay identity mismatch')
      if (replay.status === 'running') {
        replay.status = 'interrupted'
        writeWorkbenchRecord(workspace.rootPath, replay.documentId, 'replay', replay.id, replay)
      }
      return { replay }
    }
    if (request.action === 'startReplay') {
      const document = loadThoughtDocument(workspace.rootPath, request.id)
      if (!document || document.revision !== request.expectedRevision) throw new Error('Workbench revision conflict')
      if ([...replays.values()].some(entry => entry.workspaceId === workspaceId && entry.controller.replay.documentId === request.id && entry.controller.replay.status === 'running')) throw new Error('Workbench replay already running')
      const nodeIds = thoughtReplayOrder(document, request.nodeIds)
      if (!nodeIds.length) throw new Error('Select question nodes to replay')
      const controller = runThoughtReplay({ id: randomUUID(), documentId: document.id, nodeIds, completedNodeIds: [], status: 'running' }, {
        persist: replay => writeWorkbenchRecord(workspace.rootPath, document.id, 'replay', replay.id, ThoughtReplaySchema.parse(replay)),
        cancel: async generationId => { await handle(_ctx, workspaceId, { action: 'cancel', generationId }) },
        start: async nodeId => {
          const compiled = await handle(_ctx, workspaceId, { action: 'compile', id: document.id, nodeId })
          const context = compiled.context!
          const started = await handle(_ctx, workspaceId, { action: 'generate', id: document.id, nodeId, expectedRevision: context.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })
          const generation = started.generation!
          return { generationId: generation.id, finished: jobs.get(generation.id)?.finished ?? Promise.resolve(loadThoughtGeneration(workspace.rootPath, generation.id) ?? generation) }
        },
      })
      replays.set(controller.replay.id, { workspaceId, controller })
      void controller.finished.then(() => replays.delete(controller.replay.id)).catch(error => log.error('Cannot persist replay result', error))
      return { replay: controller.replay }
    }
    if (request.action === 'list') return { documents: listThoughtDocuments(workspace.rootPath) }
    if (request.action === 'exportBundle') return { bundle: exportWorkbenchBundle(workspace.rootPath, request.id) }
    if (request.action === 'importBundle') return { document: importWorkbenchBundle(workspace.rootPath, request.bundle) }
    if (request.action === 'importMaterial') return { document: importWorkbenchMaterial(workspace.rootPath, request.id, request.expectedRevision, { nodeId: request.nodeId, name: request.name, mimeType: request.mimeType, base64: request.base64, text: request.text, pages: request.pages }) }
    if (request.action === 'readMaterial') return readWorkbenchMaterial(workspace.rootPath, request.id, request.materialId)
    if (request.action === 'quoteMaterial') return { document: quoteWorkbenchMaterial(workspace.rootPath, request.id, request.expectedRevision, request.materialId, { page: request.page, start: request.start, end: request.end }) }
    if (request.action === 'proposals') return { proposals: listWorkbenchProposals(workspace.rootPath, request.id) }
    if (request.action === 'executionSources') return { executionSources: executionNodeSources(workspace.rootPath, request.id, request.nodeId) }
    if (request.action === 'applyProposal') return applyWorkbenchProposal(workspace.rootPath, request.id, request.proposalId)
    if (request.action === 'discardProposal') return { proposal: discardWorkbenchProposal(workspace.rootPath, request.id, request.proposalId) }
    if (request.action === 'importResult') return { document: importTaskResult(workspace.rootPath, request.id, request.expectedRevision, request.taskSlug, request.runId, request.nodeId) }
    if (request.action === 'importSession') {
      const session = await deps.sessionManager.getSession(request.sessionId)
      if (!session || session.workspaceId !== workspace.id) throw new Error('Unknown session in workspace')
      const document = loadThoughtDocument(workspace.rootPath, request.id)
      if (!document || document.revision !== request.expectedRevision) throw new Error('Workbench revision conflict')
      const incoming = await attachSessionMaterials(workspace.rootPath, document.id, session.id, session.messages, sessionSourceNodes(session.id, session.messages, request.messageIds))
      // Parsing attachments can yield while another window saves the draft.
      if (loadThoughtDocument(workspace.rootPath, document.id)?.revision !== document.revision) throw new Error('Workbench revision conflict')
      const next = appendSessionSources(document, incoming)
      ThoughtDocumentSchema.parse(next)
      validateThoughtGraph(next)
      recordSourceSnapshots(workspace.rootPath, document.id, incoming)
      return { document: next === document ? document : saveThoughtDocument(workspace.rootPath, next, request.expectedRevision) }
    }
    if (request.action === 'get') return { document: recoverTaskLink(workspace.rootPath, request.id) }
    if (request.action === 'reviseAnswer') {
      const document = loadThoughtDocument(workspace.rootPath, request.id)
      if (!document || document.revision !== request.expectedRevision) throw new Error('Workbench revision conflict')
      const node = document.nodes.find(item => item.id === request.nodeId)
      if (!node || node.kind !== 'question' || node.archived || typeof request.answer !== 'string') throw new Error('Select an editable question node')
      const context = await compileThoughtContext(document, node.id)
      const version = { id: randomUUID(), origin: 'manual' as const, question: node.question, answer: request.answer,
        contextHash: context.hash, model: node.model ?? '', createdAt: new Date().toISOString(), status: 'completed' as const }
      return { document: saveThoughtDocument(workspace.rootPath, { ...document, nodes: document.nodes.map(item => item.id === node.id
        ? { ...item, answer: version.answer, activeVersionId: version.id, versions: [...item.versions, version], highlights: [], highlightMode: 'off' }
        : item) }, request.expectedRevision) }
    }
    if (request.action === 'save') {
      const input = ThoughtDocumentSchema.parse(request.document)
      const previous = loadThoughtDocument(workspace.rootPath, input.id)
      if ((previous?.revision ?? 0) !== request.expectedRevision || input.revision !== request.expectedRevision) throw new Error('Workbench revision conflict')
      if (previous?.taskSlug && input.taskSlug !== previous.taskSlug) throw new Error('A linked workbench cannot change task identity')
      if (input.taskSlug !== previous?.taskSlug || input.taskEtag !== previous?.taskEtag) {
        if (!input.taskSlug || !input.taskEtag) throw new Error('Task linkage requires a task identity and ETag')
        const task = loadTaskDocument(workspace.rootPath, input.taskSlug)
        if (!task || task.etag !== input.taskEtag) throw new Error('Task definition changed; reload before linking the workbench')
      }
      const previousIds = new Set(previous?.nodes.map(node => node.id))
      const restoredSources = previous ? sourceReceipts(workspace.rootPath, input.id, input.nodes.filter(node => !previousIds.has(node.id))) : []
      assertSourceNodesUnchanged(previous, input, restoredSources)
      // Version creation belongs to generation/manual revision endpoints. A stale
      // editor may select an existing version, but cannot rewrite its receipt.
      const previousNodes = new Map([...restoredSources, ...(previous?.nodes ?? [])].map(node => [node.id, node]))
      for (const node of input.nodes) {
        if (node.activeVersionId) {
          const activeVersion = node.versions.find(version => version.id === node.activeVersionId)
          if (!activeVersion || activeVersion.answer !== node.answer) throw new Error('Active answer must match its version')
        }
        const before = previousNodes.get(node.id)
        if (!before) {
          if (node.versions.length) throw new Error('Answer versions are read-only; use answer revision')
          continue
        }
        const oldVersions = new Map(before.versions.map(version => [version.id, version]))
        if (node.versions.length !== before.versions.length || new Set(node.versions.map(version => version.id)).size !== node.versions.length || node.versions.some(version => {
          const old = oldVersions.get(version.id)
          return !old || Object.keys({ ...old, ...version }).some(key => old[key as keyof typeof old] !== version[key as keyof typeof version])
        })) throw new Error('Answer versions are read-only; use answer revision')
      }
      // This recovery marker is server-owned. A client cannot forge an applied proposal
      // by changing ordinary graph data, then use recovery to bypass its baseline check.
      if (input.lastAppliedProposalId !== previous?.lastAppliedProposalId) throw new Error('Proposal application marker is read-only')
      validateThoughtGraph(input)
      const linkIntent = previous && input.taskSlug && input.taskEtag && (input.taskSlug !== previous.taskSlug || input.taskEtag !== previous.taskEtag)
        ? { status: 'pending' as const, taskSlug: input.taskSlug, taskEtag: input.taskEtag, executionYaml: input.executionYaml,
          beforeTaskSlug: previous.taskSlug, beforeTaskEtag: previous.taskEtag, beforeExecutionYaml: previous.executionYaml } : undefined
      if (linkIntent) writeWorkbenchRecord(workspace.rootPath, input.id, 'link', 'pending', linkIntent)
      const saved = saveThoughtDocument(workspace.rootPath, input, request.expectedRevision)
      if (linkIntent) writeWorkbenchRecord(workspace.rootPath, input.id, 'link', 'pending', { ...linkIntent, status: 'applied' })
      return { document: saved }
    }
    if (request.action === 'generations') {
      const generations = listThoughtGenerations(workspace.rootPath, request.id, request.nodeId)
      for (const generation of generations) {
        if (generation.status === 'running' && !jobs.has(generation.id)) {
          generation.status = 'interrupted'
          publishGeneration(generation)
        }
      }
      return { generations }
    }
    if (request.action === 'generation' || request.action === 'cancel') {
      const job = jobs.get(request.generationId)
      if (!job) {
        const generation = loadThoughtGeneration(workspace.rootPath, request.generationId)
        if (!generation) throw new Error('Unknown generation')
        if (generation.status === 'running') {
          generation.status = 'interrupted'
          publishGeneration(generation)
        }
        return { generation }
      }
      if (job.workspaceId !== workspaceId) throw new Error('Unknown generation')
      if (request.action === 'cancel') await job.cancel()
      return { generation: job.generation }
    }
    if (request.action !== 'compile' && request.action !== 'generate') throw new Error('Unsupported workbench action')
    const document = loadThoughtDocument(workspace.rootPath, request.id)
    if (!document) throw new Error('Unknown workbench')
    const context = await compileThoughtContext(document, request.nodeId)
    if (request.action === 'generate' && (document.revision !== request.expectedRevision || context.hash !== request.contextHash)) throw new Error('Workbench context changed; refresh preview')
    const latest = loadThoughtDocument(workspace.rootPath, request.id)
    if (latest?.revision !== document.revision) throw new Error('Workbench revision conflict')
    const node = document.nodes.find(n => n.id === request.nodeId)!
    if (node.kind !== 'question' || node.archived) throw new Error('Only active question nodes may generate')
    if (!node.question.trim()) throw new Error('A question is required before generation')
    const images = context.materials.filter(material => material.mimeType.startsWith('image/')).map(material => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(material.mimeType)) throw new Error('Unsupported model image format; use PNG, JPEG, WebP or GIF')
      const original = readWorkbenchMaterial(workspace.rootPath, document.id, material.id)
      if (original.material.digest !== material.digest) throw new Error('Material changed after context compilation')
      return { mimeType: material.mimeType, data: original.base64, name: material.name, size: material.size ?? Buffer.from(original.base64, 'base64').length }
    })
    if ([...jobs.values()].some(j => j.workspaceId === workspaceId && j.generation.documentId === document.id && j.generation.nodeId === node.id && j.generation.status === 'running')) throw new Error('Node is already generating')
    const key = JSON.stringify([workspaceId, document.id, node.id])
    if (starting.has(key)) throw new Error('Node is already generating')
    starting.add(key)
    let session
    try {
      if (request.action === 'generate') {
        const previewKey = JSON.stringify([key, request.inputHash])
        const preview = request.inputHash ? previews.get(previewKey) : undefined
        if (!preview || preview.key !== key || preview.revision !== document.revision || preview.contextHash !== context.hash) throw new Error('Input preview expired or changed; refresh preview')
        previews.delete(previewKey)
        clearTimeout(preview.timer)
        session = { id: preview.sessionId }
        context.agentInput = preview.snapshot
      } else {
        session = await deps.sessionManager.createSession(workspaceId, {
          name: node.title || node.question.slice(0, 60), taskDraft: true, projectId: context.projectId,
          model: context.model, llmConnection: context.llmConnection, permissionMode: context.mode === 'agent' ? 'ask' : 'safe',
        })
        if (request.action === 'compile') {
          try {
            const snapshot = context.mode === 'agent'
              ? await deps.sessionManager.prepareThoughtAgentInput(session.id, context.prompt, images.map(image => ({ type: 'image' as const, name: image.name, mimeType: image.mimeType, base64: image.data, size: image.size, path: '' })))
              : (await deps.sessionManager.queryThoughtContext(session.id, {
                prompt: context.prompt, systemPrompt: context.systemPrompt, model: context.model, strictInput: true, previewOnly: true,
                messages: context.messages.filter((message): message is typeof message & { role: 'user' | 'assistant' } => message.role !== 'system').slice(0, -1).map(({ role, content }) => ({ role, content })),
                images: images.map(({ mimeType, data }) => ({ mimeType, data })),
              })).inputSnapshot
            if (!snapshot) throw new Error('Backend did not return an input preview')
            if (loadThoughtDocument(workspace.rootPath, document.id)?.revision !== document.revision) throw new Error('Workbench revision conflict')
            for (const [hash, previous] of previews) if (previous.key === key) await discardPreview(hash)
            const previewKey = JSON.stringify([key, snapshot.hash])
            const timer = setTimeout(() => { void discardPreview(previewKey).catch(error => log.error('Cannot clean up input preview', error)) }, 5 * 60_000)
            timer.unref?.()
            previews.set(previewKey, { key, revision: document.revision, contextHash: context.hash, sessionId: session.id, snapshot, timer })
            return { context: { ...context, agentInput: snapshot } }
          } catch (error) {
            await deps.sessionManager.discardThoughtPreview(session.id)
            throw error
          }
        }
      }
    } finally { starting.delete(key) }
    const generation: ThoughtGeneration = { id: randomUUID(), mode: context.mode, createdAt: new Date().toISOString(), documentId: document.id, nodeId: node.id, sessionId: session.id, contextHash: context.hash, status: 'running' }
    let queryCleanup: Promise<void> | undefined
    const cleanupQuerySession = () => {
      if (context.mode !== 'question') return Promise.resolve()
      // Cancellation and the model's completion finally can race. Both await
      // the same deletion, avoiding two concurrent runtime/directory teardowns.
      return queryCleanup ??= deps.sessionManager.deleteSession(session.id)
    }
    let off: (() => void) | undefined
    let offOutput: (() => void) | undefined
    let previewTimer: ReturnType<typeof setTimeout> | undefined
    let rejectCompletion: ((error: Error) => void) | undefined
    let resolveFinished!: (generation: ThoughtGeneration) => void
    const finished = new Promise<ThoughtGeneration>(resolve => { resolveFinished = resolve })
    const job = { workspaceId, generation, finished, cancel: async () => {
      if (generation.status !== 'running') return
      generation.status = 'interrupted'
      clearTimeout(previewTimer)
      off?.()
      offOutput?.()
      rejectCompletion?.(new Error('Generation cancelled'))
      resolveFinished(generation)
      try { publishGeneration(generation) }
      finally {
        try { await deps.sessionManager.cancelProcessing(session.id, true) }
        finally { await cleanupQuerySession() }
      }
    } }
    try { publishGeneration(generation, context) }
    catch (error) {
      // The model has not been dispatched yet; a failed durable start must not leak a session.
      await deps.sessionManager.deleteSession(session.id).catch(cleanupError => log.error('Cannot clean unstarted generation', cleanupError))
      throw error
    }
    jobs.set(generation.id, job)
    // Serialize explicit roles, preserving the exact graph content rather than restoring SDK history.
    const prompt = context.prompt
    let lastPreviewAt = 0
    const flushPreview = () => {
      clearTimeout(previewTimer)
      previewTimer = undefined
      if (generation.status !== 'running' || generation.answer !== undefined) return
      lastPreviewAt = Date.now()
      try { publishGeneration(generation) }
      catch (error) { log.error('Cannot persist workbench preview', error) }
    }
    const receiveOutput = (kind: 'process' | 'preview' | 'delta', text: string) => {
      if (generation.status !== 'running' || generation.answer !== undefined) return
      if (kind === 'process') generation.processText = (generation.processText ?? '') + text
      else generation.preview = kind === 'delta' ? (generation.preview ?? '') + text : text
      // Persist complete accumulated text, not a delta that could be replayed twice.
      if (Date.now() - lastPreviewAt >= 250) {
        flushPreview()
      } else if (!previewTimer) previewTimer = setTimeout(flushPreview, 250 - (Date.now() - lastPreviewAt))
    }
    void (async () => {
      try {
        let answer: string
        let model = context.model ?? ''
        if (context.mode === 'question') {
          const ordered = context.messages.filter((message): message is typeof message & { role: 'user' | 'assistant' } => message.role !== 'system')
          const history = ordered.slice(0, -1).map(({ role, content }) => ({ role, content }))
          const result = await deps.sessionManager.queryThoughtContext(session.id, { prompt, messages: history, model: context.model, systemPrompt: context.systemPrompt, strictInput: true, inputHash: context.agentInput?.hash, images: images.map(({ mimeType, data }) => ({ mimeType, data })) }, text => {
            receiveOutput('delta', text)
          })
          answer = result.text; model = result.model ?? model
        } else {
          offOutput = deps.sessionManager.onThoughtOutput(session.id, output => receiveOutput(output.kind, output.text))
          answer = await new Promise<string>((resolve, reject) => {
            rejectCompletion = reject
            off = deps.sessionManager.onSessionComplete(event => {
              if (event.sessionId !== session.id) return
              off?.()
              if (event.reason && event.reason !== 'complete') reject(new Error(`Generation ended: ${event.reason}`))
              else void deps.sessionManager.getSession(session.id).then(completed => {
                if (!completed || completed.workspaceId !== workspaceId) throw new Error('Generation session is unavailable')
                resolve(committedGenerationAnswer(completed.messages, event.finalMessageId))
              }).catch(reject)
            })
            void deps.sessionManager.sendMessage(session.id, prompt, images.map(image => ({ type: 'image' as const, name: image.name, mimeType: image.mimeType, base64: image.data, size: image.size, path: '' })), undefined, { strictInput: true, inputHash: context.agentInput?.hash }).catch(reject)
          })
        }
        if (generation.status !== 'running') return
        // Retain the delivered answer even if committing its version later conflicts.
        generation.answer = answer
        delete generation.preview
        publishGeneration(generation)
        const committed = await commitThoughtAnswer({
          nodeId: node.id,
          version: { id: generation.id, question: node.question, answer, contextHash: context.hash, model, createdAt: new Date().toISOString(), status: 'completed', sessionId: context.mode === 'agent' ? session.id : undefined },
          active: () => generation.status === 'running',
          load: () => {
            const current = loadThoughtDocument(workspace.rootPath, document.id)
            if (!current) throw new Error('Workbench was removed during generation')
            return current
          },
          commit: (current, revision) => { saveThoughtDocument(workspace.rootPath, current, revision) },
        })
        if (!committed) return
        generation.answer = answer; generation.status = 'completed'
      } catch (error) {
        if (generation.status === 'running') { generation.status = 'failed'; generation.error = error instanceof Error ? error.message : String(error) }
      } finally {
        clearTimeout(previewTimer)
        off?.()
        offOutput?.()
        try { publishGeneration(generation); jobs.delete(generation.id) }
        catch (error) { log.error('Cannot persist generation result', error) }
        resolveFinished(generation)
        await cleanupQuerySession().catch(error => log.error('Cannot clean completed query session', error))
      }
    })().catch(error => log.error('Generation cleanup failed', error))
    return { generation }
  }
  server.handle(RPC_CHANNELS.tasks.WORKBENCH, handle)
}
