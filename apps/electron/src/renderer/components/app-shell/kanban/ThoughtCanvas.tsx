import * as React from 'react'
import { workbenchContextPreview } from './workbench-context-preview'
import { createPortal } from 'react-dom'
import { workbenchExecutionTitle, workbenchExecutionProject } from './workbench-title'
import { ThoughtGenerationHistory } from './ThoughtGenerationHistory'
import { ThoughtGenerationOutput } from './ThoughtGenerationOutput'
import { acceptGenerationReceipt, recoverLiveGeneration, isNewerGeneration } from './workbench-generation-recovery'
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, type ReactFlowInstance, type NodeProps, type Node, type NodeChange, type Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { useTheme } from '@/context/ThemeContext'
import { Markdown } from '@craft-agent/ui'
import { readWorkbenchFile } from './workbench-material-file'
import { WorkbenchMaterialReader } from './WorkbenchMaterialReader'
import { ThoughtAnswerHistory } from './ThoughtAnswerHistory'
import { compileThoughtContext, validateThoughtGraph, contentHash } from '@craft-agent/shared/thought-workbench/context'
import { mergeThoughtDocuments, isWorkbenchEditConflict, type ThoughtConflictChoice, type WorkbenchEditConflict } from '@craft-agent/shared/thought-workbench/merge'
import { saveThoughtWithMerge } from '@craft-agent/shared/thought-workbench/save'
import { ThoughtConflictPanel } from './ThoughtConflictPanel'
import { restoreThoughtEdit, layoutThoughtGraph, thoughtUpstreamPath, groupThoughtNodes, thoughtGroupBounds, addThoughtSummary } from '@craft-agent/shared/thought-workbench/editing'
import { workbenchMarkdown, workbenchSvg } from '@craft-agent/shared/thought-workbench/export'
import type { ThoughtReplay } from '@craft-agent/shared/thought-workbench/types'
import {
  THOUGHT_CANVAS_EDITOR_CLASS,
  THOUGHT_CANVAS_EDITOR_TEST_ID,
  THOUGHT_CANVAS_SPLIT_CLASS,
  THOUGHT_CANVAS_SPLIT_TEST_ID,
  THOUGHT_CANVAS_STAGE_CLASS,
  THOUGHT_CANVAS_STAGE_TEST_ID,
  THOUGHT_CANVAS_TOOLBAR_CLASS,
  THOUGHT_CANVAS_TOOLBAR_TEST_ID,
} from './thought-canvas-layout'
import type { KanbanModelProviderGroup } from './types'
import { newThoughtDocument, newThoughtNode, type ThoughtDocument, type ThoughtNode, type ThoughtMaterial, type CompiledThoughtContext, type ThoughtGeneration, type WorkbenchProposalBaseline } from '@craft-agent/shared/thought-workbench/types'

interface Props {
  headerContainer?: HTMLElement | null
  disabled?: boolean
  initialDocument?: ThoughtDocument
  onBeforeSwitch?: () => Promise<void>
  onSwitchDocument?: (document: ThoughtDocument) => void
  controllerRef?: React.MutableRefObject<ThoughtCanvasController | null>
  onDocumentId?: (id: string) => void
  workspaceId: string
  taskSlug?: string
  taskEtag?: string
  projectId?: string
  model: string
  modelGroups?: KanbanModelProviderGroup[]
  llmConnection?: string
  executionYaml?: string
  executionTitle?: string
  executionDirty?: boolean
  onTitleChange?: (title: string) => boolean
  onPropose: (context: string) => void
  onOpenSession?: (sessionId: string) => void
}

export interface ThoughtCanvasController {
  setProject(projectId: string | undefined): void
  locateNode(documentId: string, nodeId: string): void
  flush(): Promise<void>
  link(taskSlug: string, taskEtag: string | undefined, executionYaml: string): Promise<void>
  prepareProposal(executionYaml: string): Promise<WorkbenchProposalBaseline>
  acceptDocument(document: ThoughtDocument): void
  assertProposalCurrent(baseline: WorkbenchProposalBaseline): void
  importResult(taskSlug: string, runId: string, nodeId: string): Promise<void>
}

const fieldClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const thoughtLayers = { group: 0, node: 1 } as const
const thoughtNodeTypes = { thoughtGroup: ({ data }: NodeProps<Node<{ label: string }>>) => <div className="h-full w-full px-3 py-2 text-xs font-medium">{data.label}</div> }

/** A document-scoped surface: all async operations capture identity before awaiting. */
export function ThoughtCanvas(props: Props) {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const { onDocumentId } = props
  const [document, setDocument] = React.useState<ThoughtDocument | null>(null)
  const current = React.useRef<ThoughtDocument | null>(null)
  const [documents, setDocuments] = React.useState<ThoughtDocument[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [search, setSearch] = React.useState('')
  const flow = React.useRef<Pick<ReactFlowInstance, 'fitView'> | null>(null)
  const [pathFocus, setPathFocus] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const bundleInput = React.useRef<HTMLInputElement>(null)
  const [readerMaterialId, setReaderMaterialId] = React.useState<string>()
  const [error, setError] = React.useState('')
  const [conflict, setConflict] = React.useState<WorkbenchEditConflict | null>(null)
  const resolutions = React.useRef<Record<string, ThoughtConflictChoice>>({})
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [previewContext, setContext] = React.useState<CompiledThoughtContext | null>(null)
  const [generation, setGeneration] = React.useState<ThoughtGeneration | null>(null)
  const [replay, setReplay] = React.useState<ThoughtReplay | null>(null)
  const [history, setHistory] = React.useState<ThoughtDocument[]>([])
  const [availableMaterials, setAvailableMaterials] = React.useState<ThoughtMaterial[]>([])
  const [includedMaterials, setIncludedMaterials] = React.useState<Set<string>>(new Set())
  const [stale, setStale] = React.useState(false)
  const [answerDraft, setAnswerDraft] = React.useState<{ nodeId: string; answer: string } | null>(null)
  const [highlightSelection, setHighlightSelection] = React.useState<{ nodeId: string; text: string } | null>(null)
  const saving = React.useRef(false)
  const switching = React.useRef(false)
  const persisted = React.useRef<ThoughtDocument | null>(null)
  const editSerial = React.useRef(0)
  const mounted = React.useRef(true)
  const request = React.useCallback((input: Parameters<typeof window.electronAPI.thoughtWorkbench>[1]) => window.electronAPI.thoughtWorkbench(props.workspaceId, input), [props.workspaceId])
  const install = React.useCallback((next: ThoughtDocument, authoritative = true) => { if (authoritative) persisted.current = next; current.current = next; setDocument(next); if (next.revision > 0) onDocumentId?.(next.id) }, [onDocumentId])
  const fail = React.useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), [])
  React.useEffect(() => { setAnswerDraft(null); setHighlightSelection(null) }, [document?.id])

  const persistedDocumentId = document && document.revision > 0 ? document.id : undefined
  const visibleGeneration = generation?.documentId === document?.id ? generation : null
  React.useEffect(() => {
    setReplay(null)
    if (!persistedDocumentId) return
    let active = true
    void request({ action: 'replays', id: persistedDocumentId }).then(result => {
      if (!active || current.current?.id !== persistedDocumentId) return
      setReplay(previous => previous?.documentId === persistedDocumentId ? previous : result.replays?.find(item => item.status === 'running') ?? null)
    }).catch(reason => { if (active) fail(reason) })
    return () => { active = false }
  }, [persistedDocumentId, request, fail])
  // A workspace may have been generating in multiple windows. Once the
  // currently observed job finishes, discover and observe the next live job.
  React.useEffect(() => {
    if (!persistedDocumentId) { setGeneration(null); return }
    let active = true
    void request({ action: 'generations', id: persistedDocumentId }).then(result => {
      if (!active || current.current?.id !== persistedDocumentId) return
      // Reattach observation only. Recovery must never dispatch another request
      // to the model or resume an interrupted Agent's external tool execution.
      setGeneration(previous => recoverLiveGeneration(persistedDocumentId, previous, result.generations ?? []))
    }).catch(reason => { if (active) fail(reason) })
    return () => { active = false }
  }, [persistedDocumentId, generation?.id, generation?.status, request, fail])

  React.useEffect(() => {
    mounted.current = true
    let active = true
    void request({ action: 'list' }).then(result => {
      if (!active) return
      const docs = result.documents ?? []
      setDocuments(docs)
      const match = props.initialDocument ? docs.find(doc => doc.id === props.initialDocument!.id) : props.taskSlug ? docs.find(doc => doc.taskSlug === props.taskSlug) : undefined
      install(match ?? { ...newThoughtDocument(crypto.randomUUID()), projectId: props.projectId, taskSlug: props.taskSlug, taskEtag: props.taskEtag })
      setDirty(!match)
    }).catch(fail)
    return () => { active = false; mounted.current = false }
    // Project and task ETag changes must not replace unsaved workbench state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, props.taskSlug, install, fail])

  function edit(next: ThoughtDocument, remember = true) {
    if (busy || switching.current || replay?.status === 'running') return
    // The graph undo stack cannot roll back server-owned application receipts.
    next = { ...next, lastAppliedProposalId: current.current?.lastAppliedProposalId }
    if (remember && current.current) setHistory(items => [...items.slice(-49), current.current!])
    editSerial.current++
    install(next, false); setDirty(true); setContext(null); setError('')
  }

  const save = React.useCallback(async (): Promise<ThoughtDocument | null> => {
    const snapshot = current.current
    if (!snapshot || saving.current) return null
    saving.current = true
    const serial = editSerial.current
    try {
      const saved = await saveThoughtWithMerge({
        base: persisted.current ?? snapshot, local: snapshot,
        resolutions: resolutions.current,
        write: async pending => {
          const result = await request({ action: 'save', document: pending, expectedRevision: pending.revision })
          if (!result.document) throw new Error('Workbench save returned no document')
          return result.document
        },
        load: async () => {
          const result = await request({ action: 'get', id: snapshot.id })
          if (!result.document) throw new Error('Workbench was removed during saving')
          return result.document
        },
      })
      const result = { document: saved }
      if (!mounted.current || current.current?.id !== snapshot.id) return null
      if (result.document) {
        // Preserve edits made while the server was acknowledging the preceding write.
        if (serial === editSerial.current) { install(result.document); setDirty(false) }
        else {
          // Hashing may itself overlap typing. Reconcile against the newest local
          // edit before accepting the server revision, never a stale UI snapshot.
          while (mounted.current && current.current?.id === snapshot.id) {
            const pendingSerial = editSerial.current
            const merged = await mergeThoughtDocuments(snapshot, current.current, result.document, resolutions.current)
            if (pendingSerial !== editSerial.current) continue
            persisted.current = result.document
            install(merged, false)
            break
          }
        }
        setDocuments(items => [result.document!, ...items.filter(item => item.id !== result.document!.id)])
      }
      resolutions.current = {}
      setConflict(null)
      return result.document ?? null
    } catch (reason) {
      if (isWorkbenchEditConflict(reason)) { setConflict(reason); return null }
      fail(reason); return null
    }
    finally { saving.current = false }
  }, [request, install, fail])

  React.useEffect(() => {
    if (!props.controllerRef) return
    props.controllerRef.current = {
      setProject(projectId) {
        const snapshot = current.current
        if (!snapshot || busy || switching.current || replay?.status === 'running') throw new Error(t('thought.unsaved'))
        if (snapshot.projectId === projectId) return
        editSerial.current++
        install({ ...snapshot, projectId }, false)
        setDirty(true)
        setContext(null)
      },
      locateNode(documentId, nodeId) {
        const snapshot = current.current
        const node = snapshot?.nodes.find(item => item.id === nodeId && !item.archived)
        if (!snapshot || snapshot.id !== documentId || !node) throw new Error(t('tasks.notAvailable'))
        setSelected([nodeId]); setSearch(''); setPathFocus(false); setContext(null)
        const group = snapshot.groups?.find(item => item.collapsed && item.nodeIds.includes(nodeId))
        requestAnimationFrame(() => {
          if (current.current?.id === documentId && mounted.current) void flow.current?.fitView({ nodes: [{ id: group ? `group:${group.id}` : nodeId }], padding: 0.3 })
        })
      },
      async importResult(taskSlug, runId, nodeId) {
        const serial = editSerial.current
        const saved = await save()
        if (!saved) throw new Error('Workbench save pending')
        const result = await request({ action: 'importResult', id: saved.id, expectedRevision: saved.revision, taskSlug, runId, nodeId })
        if (!result.document || current.current?.id !== saved.id || serial !== editSerial.current) throw new Error('Workbench changed while importing result; reload to see the imported source')
        install(result.document); setDirty(false); setContext(null)
        const added = result.document.nodes.find(n => !saved.nodes.some(previous => previous.id === n.id))
        if (added) setSelected([added.id])
      },
      assertProposalCurrent(baseline) {
        if (dirty || saving.current || current.current?.id !== baseline.documentId || current.current.revision !== baseline.documentRevision) throw new Error('Workbench proposal baseline changed; regenerate the proposal')
      },
      acceptDocument(next) {
        if (current.current?.id !== next.id || saving.current || dirty) throw new Error('Workbench changed while applying proposal')
        install(next); setDirty(false); setContext(null)
      },
      async prepareProposal(executionYaml) {
        if (generation?.status === 'running' || replay?.status === 'running' || busy || saving.current || !current.current) throw new Error('Workbench is busy; try again when saving finishes')
        saving.current = true
        const snapshot = current.current
        const serial = editSerial.current
        try {
          const result = await request({ action: 'save', document: { ...snapshot, title: workbenchExecutionTitle(executionYaml, snapshot.title), projectId: workbenchExecutionProject(executionYaml, snapshot.projectId), executionYaml }, expectedRevision: snapshot.revision })
          if (!result.document || current.current?.id !== snapshot.id) throw new Error('Workbench changed while preparing proposal')
          if (serial !== editSerial.current) {
            persisted.current = result.document
            install({ ...current.current, revision: result.document.revision }, false); throw new Error('Workbench changed; retry proposal')
          }
          install(result.document); setDirty(false); setContext(null)
          return { documentId: snapshot.id, documentRevision: result.document.revision, executionHash: await contentHash(executionYaml), taskEtag: snapshot.taskEtag, nodeIds: [...selected] }
        } finally { saving.current = false }
      },
      async flush() {
        if (busy) throw new Error('Workbench operation pending; retry after it finishes')
        if (!await save()) throw new Error('Workbench save pending or failed; retry after it finishes')
      },
      async link(taskSlug, taskEtag, executionYaml) {
        if (!current.current || saving.current) throw new Error('Workbench save pending')
        saving.current = true
        const snapshot = current.current
        try {
          const next = { ...snapshot, title: workbenchExecutionTitle(executionYaml, snapshot.title), projectId: workbenchExecutionProject(executionYaml, snapshot.projectId), taskSlug, taskEtag, executionYaml }
          const linked = await saveThoughtWithMerge({
            base: persisted.current ?? snapshot, local: next,
            resolutions: resolutions.current,
            write: async document => {
              if (!mounted.current || current.current?.id !== snapshot.id) throw new Error('Workbench changed while linking')
              const result = await request({ action: 'save', document, expectedRevision: document.revision })
              if (!result.document) throw new Error('Workbench link was not saved')
              return result.document
            },
            load: async () => {
              const result = await request({ action: 'get', id: snapshot.id })
              if (!result.document) throw new Error('Workbench is unavailable')
              return result.document
            },
          })
          while (mounted.current && current.current?.id === snapshot.id) {
            const serial = editSerial.current
            const merged = await mergeThoughtDocuments(snapshot, current.current, linked, resolutions.current)
            if (serial !== editSerial.current) continue
            persisted.current = linked
            install(merged, false); setDirty(JSON.stringify(merged) !== JSON.stringify(linked))
            return
          }
          throw new Error('Workbench changed while linking the saved task')
        } catch (reason) {
          if (isWorkbenchEditConflict(reason)) { setConflict(reason); return }
          throw reason
        } finally { saving.current = false }
      },
    }
    return () => { if (props.controllerRef) props.controllerRef.current = null }
  }, [props.controllerRef, request, install, save, selected, busy, dirty, generation?.status, replay?.status, t])

  React.useEffect(() => {
    if (!dirty || replay?.status === 'running' || error || conflict) return
    const timer = setTimeout(() => { void save() }, 600)
    return () => clearTimeout(timer)
  }, [dirty, document, generation?.status, replay?.status, error, conflict, save])

  const resolveConflict = React.useCallback((choice: ThoughtConflictChoice) => {
    if (!conflict) return
    resolutions.current = { ...resolutions.current, [conflict.path]: choice }
    setConflict(null)
    void save()
  }, [conflict, save])

  const reconcileRemote = React.useCallback(async (remote: ThoughtDocument, active: () => boolean): Promise<boolean> => {
    if (!active() || saving.current || current.current?.id !== remote.id) return false
    const base = persisted.current
    if (!base || base.id !== remote.id) return false
    if (remote.revision < base.revision) return true
    saving.current = true
    try {
      while (active() && mounted.current && current.current?.id === remote.id) {
        const serial = editSerial.current
        const merged = await mergeThoughtDocuments(base, current.current, remote, resolutions.current)
        if (!active()) return false
        if (serial !== editSerial.current) continue
        persisted.current = remote
        install(merged, false)
        setDirty(JSON.stringify(merged) !== JSON.stringify(remote))
        return true
      }
      return false
    } catch (reason) {
      if (isWorkbenchEditConflict(reason)) { setConflict(reason); return false }
      throw reason
    } finally { saving.current = false }
  }, [install])

  React.useEffect(() => {
    if (!generation || generation.status !== 'running' || generation.documentId !== persistedDocumentId) return
    let active = true
    let polling = false
    const refresh = () => {
      if (polling || saving.current) return
      polling = true
      void request({ action: 'generation', generationId: generation.id }).then(async result => {
        if (!active || current.current?.id !== generation.documentId || !result.generation || !isNewerGeneration(generation, result.generation)) return
        if (result.generation.status === 'completed') {
          const loaded = await request({ action: 'get', id: generation.documentId })
          if (!loaded.document || !await reconcileRemote(loaded.document, () => active)) return
        } else if (result.generation.error) setError(result.generation.error)
        const receipt = result.generation
        if (active) setGeneration(previous => previous?.id === receipt.id ? acceptGenerationReceipt(current.current?.id, previous, receipt) : previous)
      }).catch(reason => { if (active) fail(reason) }).finally(() => { polling = false })
    }
    const unsubscribe = window.electronAPI.onWorkbenchGeneration((workspaceId, receipt) => {
      if (workspaceId === props.workspaceId && isNewerGeneration(generation, receipt)) refresh()
    })
    // Polling recovers lost notifications and reconnects; it never restarts execution.
    const timer = setInterval(refresh, 800)
    return () => { active = false; unsubscribe(); clearInterval(timer) }
  }, [generation, persistedDocumentId, props.workspaceId, request, reconcileRemote, fail])

  const node = document?.nodes.find(item => item.id === selected[0])
  const context = previewContext?.documentId === document?.id && previewContext?.targetId === node?.id
    && previewContext?.revision === document?.revision ? previewContext : null
  React.useEffect(() => {
    let active = true
    setAvailableMaterials([]); setIncludedMaterials(new Set()); setStale(false)
    if (!document || !node) return
    const version = node.versions.find(item => item.id === node.activeVersionId)
    void Promise.all([
      compileThoughtContext(document, node.id),
      compileThoughtContext({ ...document, nodes: document.nodes.map(item => ({ ...item, excludedMaterialIds: [] })) }, node.id),
    ]).then(([actual, available]) => {
      if (!active) return
      setAvailableMaterials(available.materials)
      setIncludedMaterials(new Set(actual.materials.map(material => material.id)))
      setStale(!!version && version.contextHash !== actual.hash)
    }).catch(fail)
    return () => { active = false }
  }, [document, node, fail])
  React.useEffect(() => {
    if (replay?.status !== 'running') return
    let active = true
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void request({ action: 'replay', id: replay.documentId, replayId: replay.id }).then(async result => {
        if (!active || !result.replay) return
        const loaded = await request({ action: 'get', id: replay.documentId })
        if (!active) return
        if (!loaded.document || !await reconcileRemote(loaded.document, () => active)) return
        setReplay(result.replay)
        if (result.replay.error) setError(result.replay.error)
      }).catch(fail).finally(() => { polling = false })
    }, 800)
    return () => { active = false; clearInterval(timer) }
  }, [replay, request, reconcileRemote, fail])
  const running = visibleGeneration?.status === 'running' || replay?.status === 'running'
  const inputLocked = busy || replay?.status === 'running'
  async function startReplay() {
    setBusy(true)
    try {
      const saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      const result = await request({ action: 'startReplay', id: saved.id, expectedRevision: saved.revision, nodeIds: selected })
      setReplay(result.replay ?? null); setContext(null)
    } catch (reason) { fail(reason) } finally { setBusy(false) }
  }
  function changeNode(patch: Partial<ThoughtNode>) {
    // A generation owns its input snapshot, not the editable document. Replay
    // remains exclusive because it compiles subsequent nodes after each result.
    if (!document || !node || inputLocked) return
    edit({ ...document, nodes: document.nodes.map(item => item.id === node.id ? { ...item, ...patch } : item) })
  }
  function add(kind: ThoughtNode['kind'] = 'question') {
    if (!document || busy || running) return
    const id = crypto.randomUUID()
    const item = { ...newThoughtNode(id, { x: node ? node.position.x + 300 : 0, y: node ? node.position.y : document.nodes.length * 160 }),
      kind, model: props.model, llmConnection: props.llmConnection }
    const edges = selected.map((source, order) => ({ id: crypto.randomUUID(), source, target: id, kind: 'context' as const, order, depth: 'full' as const }))
    edit({ ...document, nodes: [...document.nodes, item], edges: [...document.edges, ...edges] }); setSelected([id])
  }
  function connect(connection: Connection) {
    if (!document || busy || running || !connection.source || !connection.target) return
    const next = { ...document, edges: [...document.edges, { id: crypto.randomUUID(), source: connection.source, target: connection.target, kind: 'context' as const, order: document.edges.length, depth: 'full' as const }] }
    try { validateThoughtGraph(next); edit(next) } catch (reason) { fail(reason) }
  }
  async function preview() {
    if (!node) return
    // Imported drafts may predate model selection. Freeze the default shown in
    // the picker before compiling, rather than inheriting a later default at run.
    const pinDefaults = !node.model && !node.llmConnection && !!props.model && !!props.llmConnection && !!current.current
    if (pinDefaults && current.current) {
      edit({ ...current.current, nodes: current.current.nodes.map(item => item.id === node.id
        ? { ...item, model: props.model, llmConnection: props.llmConnection } : item) })
    }
    const serialAtStart = editSerial.current
    setBusy(true)
    try {
      const saved = pinDefaults || dirty || !document?.revision ? await save() : current.current
      if (!saved || editSerial.current !== serialAtStart) return
      const result = await request({ action: 'compile', id: saved.id, nodeId: node.id })
      if (current.current?.id === saved.id && current.current.revision === saved.revision) setContext(result.context ?? null)
    } catch (reason) { fail(reason) } finally { setBusy(false) }
  }
  async function generate() {
    if (!context || !document) return
    setBusy(true)
    try {
      const result = await request({ action: 'generate', id: document.id, nodeId: context.targetId, expectedRevision: context.revision, contextHash: context.hash, inputHash: context.agentInput?.hash })
      if (mounted.current && result.generation?.documentId === document.id && result.generation.nodeId === context.targetId) {
        const receipt = result.generation
        setGeneration(previous => acceptGenerationReceipt(current.current?.id, previous, receipt))
      }
    } catch (reason) {
      if (mounted.current && current.current?.id === document.id) fail(reason)
    } finally {
      if (mounted.current && current.current?.id === document.id) setBusy(false)
    }
  }
  async function reviseAnswer() {
    if (!answerDraft || !node || node.id !== answerDraft.nodeId) return
    setBusy(true)
    try {
      const saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      const result = await request({ action: 'reviseAnswer', id: saved.id, nodeId: node.id, expectedRevision: saved.revision, answer: answerDraft.answer })
      if (result.document && current.current?.id === saved.id) {
        install(result.document); setDirty(false); setContext(null); setAnswerDraft(null)
      }
    } catch (reason) { fail(reason) } finally { setBusy(false) }
  }
  async function importFiles(files: File[]) {
    if (busy || running) return
    setBusy(true); setError('')
    try {
      let saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      for (const file of files) {
        const input = await readWorkbenchFile(file)
        const result = await request({ action: 'importMaterial', id: saved.id, expectedRevision: saved.revision, ...input })
        if (!result.document || current.current?.id !== saved.id) throw new Error(t('thought.importFailed'))
        saved = result.document; install(saved); setDirty(false); setContext(null)
        const added = saved.nodes.at(-1)
        if (added) { setSelected([added.id]); setReaderMaterialId(added.materials[0]?.id) }
      }
    } catch (error) { fail(error) } finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  async function quoteMaterial(selection: { materialId: string; page?: number; start: number; end: number }) {
    const saved = await save()
    if (!saved) throw new Error(t('thought.unsaved'))
    const serial = editSerial.current
    const result = await request({ action: 'quoteMaterial', id: saved.id, expectedRevision: saved.revision, ...selection })
    if (!result.document || current.current?.id !== saved.id || serial !== editSerial.current) throw new Error(t('thought.importFailed'))
    install(result.document); setDirty(false); setContext(null)
    const added = result.document.nodes.at(-1)
    if (added) { setSelected([added.id]); setReaderMaterialId(added.materials[0]?.id) }
  }
  const focusedPath = React.useMemo(() => pathFocus && document ? thoughtUpstreamPath(document, selected) : null, [pathFocus, document, selected])
  const collapsedNodes = new Set(document?.groups?.filter(group => group.collapsed).flatMap(group => group.nodeIds) ?? [])
  const groupNodes: Node[] = (document?.groups ?? []).map(group => {
    const bounds = thoughtGroupBounds(document!, group.nodeIds)
    return { id: `group:${group.id}`, type: 'thoughtGroup', position: { x: bounds.x, y: bounds.y },
      width: group.collapsed ? 280 : bounds.width, height: group.collapsed ? 64 : bounds.height, zIndex: thoughtLayers.group,
      data: { label: `${group.title} (${group.nodeIds.length})` }, selectable: false, connectable: false,
      style: { width: group.collapsed ? 280 : bounds.width, height: group.collapsed ? 64 : bounds.height,
        background: 'color-mix(in srgb, var(--muted) 35%, transparent)', color: 'var(--foreground)', border: '1px dashed var(--border)', borderRadius: 12 } }
  })
  const flowNodes: Node[] = [...groupNodes, ...(document?.nodes ?? []).map<Node>(item => ({ id: item.id, position: item.position, selected: selected.includes(item.id),
    width: 240, height: 80,
    zIndex: thoughtLayers.node,
    data: { label: <span className="line-clamp-3 break-words leading-4" title={item.title || item.question}>{item.title || item.question || t('thought.question')}</span> },
    className: focusedPath && !focusedPath.has(item.id) ? 'opacity-20' : item.archived ? 'opacity-50' : undefined,
    style: { background: 'var(--card)', color: 'var(--foreground)', borderColor: selected.includes(item.id) ? 'var(--ring)' : 'var(--border)', width: 240, height: 80, overflowWrap: 'anywhere' },
    hidden: collapsedNodes.has(item.id) || (!!search && !`${item.title} ${item.question} ${item.answer}`.toLowerCase().includes(search.toLowerCase())),
  }))]
  function changeNodes(changes: NodeChange[]) {
    if (!document || running || busy) return
    const next = applyNodeChanges(changes, flowNodes)
    const memberGroups = new Map(document.groups?.flatMap(group => group.nodeIds.map(id => [id, group.id] as const)))
    const groupPositions = new Map(groupNodes.map(group => [group.id, group.position]))
    // Dimension notifications are internal to React Flow. Replacing selection
    // on each notification rebuilds controlled nodes before measurement settles.
    if (changes.some(change => change.type === 'select')) setSelected(next.filter(item => item.selected && !item.id.startsWith('group:')).map(item => item.id))
    if (changes.some(change => change.type === 'position' && change.position)) edit({ ...document,
      nodes: document.nodes.map(item => {
        const group = memberGroups.get(item.id)
        const moved = group ? changes.find(change => change.type === 'position' && change.id === `group:${group}`) : undefined
        if (group && moved?.type === 'position' && moved.position) {
          const previous = groupPositions.get(`group:${group}`)!
          return { ...item, position: { x: item.position.x + moved.position.x - previous.x, y: item.position.y + moved.position.y - previous.y } }
        }
        return { ...item, position: next.find(n => n.id === item.id)?.position ?? item.position }
      }),
    }, false)
  }
  async function download() {
    try {
      await props.onBeforeSwitch?.()
      setBusy(true)
      const saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      const result = await request({ action: 'exportBundle', id: saved.id })
      if (!result.bundle) throw new Error(t('thought.importFailed'))
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.bundle)], { type: 'application/json' }))
      const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `${saved.id}.selection-workbench.json`; anchor.click(); URL.revokeObjectURL(url)
    } catch (reason) { fail(reason) } finally { setBusy(false) }
  }
  async function exportView(format: 'md' | 'svg') {
    try {
      await props.onBeforeSwitch?.()
      setBusy(true)
      const saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      const text = format === 'md' ? workbenchMarkdown(saved) : workbenchSvg(saved)
      const url = URL.createObjectURL(new Blob([text], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'image/svg+xml;charset=utf-8' }))
      const anchor = window.document.createElement('a')
      anchor.href = url; anchor.download = `${saved.id}.${format}`; anchor.click(); URL.revokeObjectURL(url)
    } catch (reason) { fail(reason) } finally { setBusy(false) }
  }
  async function importBundle(file: File) {
    setBusy(true)
    try {
      await props.onBeforeSwitch?.()
      if (!await save()) throw new Error(t('thought.unsaved'))
      const result = await request({ action: 'importBundle', bundle: JSON.parse(await file.text()) })
      if (!result.document) throw new Error(t('thought.importFailed'))
      if (props.onSwitchDocument) { props.onSwitchDocument(result.document); return }
      install(result.document); setDirty(false); setSelected([]); setHistory([]); setContext(null); setGeneration(null)
      setDocuments(items => [result.document!, ...items]); setError('')
    } catch (reason) { fail(reason) } finally { setBusy(false); if (bundleInput.current) bundleInput.current.value = '' }
  }
  async function switchDocument(id: string) {
    if (switching.current || busy || !current.current || id === current.current.id) return
    switching.current = true
    const sourceId = current.current.id
    try {
      await props.onBeforeSwitch?.()
      setBusy(true)
      const saved = await save()
      if (!saved) throw new Error(t('thought.unsaved'))
      const result = await request({ action: 'get', id })
      if (!mounted.current || current.current?.id !== sourceId) return
      if (!result.document) throw new Error(t('thought.importFailed'))
      if (props.onSwitchDocument) props.onSwitchDocument(result.document)
      else { install(result.document); setSelected([]); setHistory([]); setContext(null) }
    } catch (reason) { if (mounted.current) fail(reason) }
    finally { switching.current = false; if (mounted.current) setBusy(false) }
  }

  if (!document) return <div role="status" className="animate-pulse p-4 motion-reduce:animate-none">{error || t('common.loading')}</div>
  const documentControls = <>
    <input aria-label={t('tasks.title')} placeholder={t('tasks.titlePlaceholder')} className={`${fieldClass} min-w-24 max-w-48`} value={props.executionTitle ?? document.title} disabled={props.disabled || busy || replay?.status === 'running'} onChange={event => {
      if (props.onTitleChange?.(event.target.value) === false) return
      edit({ ...document, title: event.target.value })
    }} />
    <select aria-label={t('thought.drafts')} className="max-w-48 rounded-md border border-border bg-background p-2 text-sm" value={document.id} disabled={props.disabled || dirty || running || busy} onChange={event => { void switchDocument(event.target.value) }}>
      <option value={document.id}>{document.title || t('thought.drafts')}</option>{documents.filter(item => item.id !== document.id).map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}
    </select>
    <span role="status" className="text-xs text-muted-foreground">{t('thought.view')} · {dirty || props.executionDirty ? t('thought.unsaved') : t('thought.saved')}</span>
  </>
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    {props.headerContainer && createPortal(documentControls, props.headerContainer)}
    <div data-testid={THOUGHT_CANVAS_TOOLBAR_TEST_ID} className={THOUGHT_CANVAS_TOOLBAR_CLASS}>
      {!props.headerContainer && documentControls}
      <Button size="sm" variant="outline" disabled={running} onClick={() => add()}>{selected.length > 1 ? t('thought.merge') : t('thought.question')}</Button>
      <Button size="sm" variant="outline" disabled={running} onClick={() => add('note')}>{t('thought.note')}</Button>
      <input ref={fileInput} type="file" multiple className="hidden" aria-label={t('thought.addMaterial')} accept=".pdf,.docx,.html,.htm,.md,.txt,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.cpp,.c,.h,.sh,.css,.xml,image/*" onChange={event => { void importFiles(Array.from(event.target.files ?? [])) }} />
      <Button size="sm" variant="outline" disabled={busy || running} onClick={() => fileInput.current?.click()}>{t('thought.addMaterial')}</Button>
      <input ref={bundleInput} type="file" accept=".json" className="hidden" aria-label={t('thought.importBundle')} onChange={event => { const file = event.target.files?.[0]; if (file) void importBundle(file) }} />
      {replay && <span role="status" className="truncate text-xs text-muted-foreground">{replay.completedNodeIds.length} / {replay.nodeIds.length}</span>}
      {replay?.status === 'running' && <Button size="sm" variant="outline" onClick={() => { void request({ action: 'cancelReplay', id: replay.documentId, replayId: replay.id }).then(result => setReplay(result.replay ?? null)).catch(fail) }}>{t('common.cancel')}</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="ml-auto px-2" aria-label={t('common.more')}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem disabled={busy || running || !selected.length} onSelect={() => {
            const id = crypto.randomUUID()
            const next = addThoughtSummary(document, selected, id, t('thought.summary'), t('thought.summaryPrompt'))
            edit({ ...next, nodes: next.nodes.map(item => item.id === id ? { ...item, model: props.model, llmConnection: props.llmConnection } : item) })
            setSelected([id])
          }}>{t('thought.summary')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running || !selected.length} onSelect={() => edit(groupThoughtNodes(document, selected, crypto.randomUUID(), t('thought.group')))}>{t('thought.group')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running} onSelect={() => { edit(layoutThoughtGraph(document)); requestAnimationFrame(() => { void flow.current?.fitView({ padding: 0.15 }) }) }}>{t('thought.autoLayout')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={!selected.length} onSelect={() => {
            setPathFocus(!pathFocus)
            if (!pathFocus) { setSearch(''); void flow.current?.fitView({ nodes: [...thoughtUpstreamPath(document, selected)].map(id => ({ id })), padding: 0.2 }) }
          }}>{t('thought.locatePath')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running || !selected.length} onSelect={() => { void startReplay() }}>{t('thought.replay')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={running || !history.length} onSelect={() => { const previous = history.at(-1); if (previous) { edit(restoreThoughtEdit(document, previous), false); setHistory(history.slice(0, -1)) } }}>{t('thought.undo')}</StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem disabled={busy || running} onSelect={() => { void download() }}>{t('common.export')}</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running} onSelect={() => { void exportView('md') }}>{t('common.export')} Markdown</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running} onSelect={() => { void exportView('svg') }}>{t('common.export')} SVG</StyledDropdownMenuItem>
          <StyledDropdownMenuItem disabled={busy || running} onSelect={() => bundleInput.current?.click()}>{t('thought.importBundle')}</StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </div>
    {conflict && <ThoughtConflictPanel conflict={conflict} onKeepMine={() => resolveConflict('local')} onKeepTheirs={() => resolveConflict('remote')} onDismiss={() => setConflict(null)} />}
    {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{error}<Button variant="ghost" onClick={() => setError('')}>{t('common.close')}</Button></div>}
    {!!document.groups?.length && <details><summary className="text-sm">{t('thought.groups')}</summary><div className="flex flex-wrap gap-3 py-2">{document.groups.map(group => <div key={group.id} className="flex items-center gap-2 rounded-md border p-2">
      <input aria-label={t('thought.group')} className={`${fieldClass} max-w-40`} disabled={busy || running} value={group.title} onChange={event => edit({ ...document, groups: document.groups!.map(item => item.id === group.id ? { ...item, title: event.target.value } : item) })} />
      <Button variant="ghost" disabled={busy || running} onClick={() => edit({ ...document, groups: document.groups!.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}>{group.collapsed ? t('thought.expandGroup') : t('thought.collapseGroup')}</Button>
      <Button variant="ghost" disabled={busy || running} onClick={() => edit({ ...document, groups: document.groups!.filter(item => item.id !== group.id) })}>{t('thought.ungroup')}</Button>
    </div>)}</div></details>}
    <div data-testid={THOUGHT_CANVAS_SPLIT_TEST_ID} className={THOUGHT_CANVAS_SPLIT_CLASS}>
      <div data-testid={THOUGHT_CANVAS_STAGE_TEST_ID} className={THOUGHT_CANVAS_STAGE_CLASS}>
        <input aria-label={t('common.search')} className="absolute left-3 top-3 z-10 w-48 rounded-md border bg-background px-3 py-2 text-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('common.search')} />
        <ReactFlow onInit={instance => { flow.current = instance }} nodes={flowNodes} edges={document.edges.map(edge => ({ ...edge, style: { strokeDasharray: edge.kind === 'reference' ? '5 5' : undefined, opacity: focusedPath && (!focusedPath.has(edge.source) || !focusedPath.has(edge.target)) ? 0.15 : 1 } }))}
          nodeTypes={thoughtNodeTypes} colorMode={isDark ? 'dark' : 'light'}
          onNodesChange={changeNodes} onConnect={connect} nodesDraggable={!running} nodesConnectable={!running}
          onNodeClick={(event, item) => { if (item.id.startsWith('group:')) return; if (!event.metaKey && !event.ctrlKey && !event.shiftKey) setSelected([item.id]); setContext(null) }} deleteKeyCode={null} minZoom={0.001} fitView fitViewOptions={{ minZoom: 0.001, maxZoom: 1.2 }} onlyRenderVisibleElements>
          <Background /><Controls /><MiniMap /></ReactFlow>
      </div>
      <aside data-testid={THOUGHT_CANVAS_EDITOR_TEST_ID} className={THOUGHT_CANVAS_EDITOR_CLASS}>
        {!node ? <p className="text-sm leading-relaxed text-muted-foreground">{t('thought.empty')}</p> : <>
          <input aria-label={t('tasks.title')} className={fieldClass} value={node.title} disabled={inputLocked} onChange={event => changeNode({ title: event.target.value })} />
          <textarea aria-label={t('thought.question')} className={`${fieldClass} min-h-28`} value={node.question} disabled={inputLocked || node.kind === 'result'} onChange={event => changeNode({ question: event.target.value })} />
          <select aria-label={t('thought.mode')} className={fieldClass} value={node.mode} disabled={running} onChange={event => changeNode({ mode: event.target.value as ThoughtNode['mode'] })}>
            <option value="question">{t('thought.question')}</option><option value="agent">Agent</option></select>
          <label className="space-y-1 text-xs">{t('tasks.nodeModel')}
            <select className={fieldClass} disabled={busy || running || node.kind === 'result'} value={JSON.stringify([node.llmConnection ?? '', node.model ?? ''])} onChange={event => {
              const [connection, model] = JSON.parse(event.target.value) as [string, string]
              changeNode({ model: model || undefined, llmConnection: connection || undefined })
            }}>
              <option value={JSON.stringify([node.llmConnection ?? '', node.model ?? ''])}>{node.model || props.model || t('thought.modelNotConfigured')}{node.llmConnection ? ` · ${node.llmConnection}` : ''}</option>
              {(props.modelGroups ?? []).map((group, index) => <optgroup key={`${group.connectionSlug}:${index}`} label={group.label}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.connectionSlug ?? '', model.id])}>{model.name}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">{t('thought.roleInstructions')}<textarea className={`${fieldClass} min-h-20`} value={node.role ?? ''} disabled={inputLocked || node.kind === 'result'} onChange={event => changeNode({ role: event.target.value || undefined })} /></label>
          {stale && <p role="status" className="text-xs text-muted-foreground">{t('thought.staleAnswer')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || running} onClick={() => void preview()}>{t('thought.context')}</Button>
            <Button disabled={busy || running || !context || node.kind !== 'question' || node.archived} onClick={() => void generate()}>{t('thought.generate')}</Button>
            {visibleGeneration?.status === 'running' && <Button variant="outline" onClick={() => { void request({ action: 'cancel', generationId: visibleGeneration.id }).then(result => {
              const receipt = result.generation
              if (mounted.current && receipt?.id === visibleGeneration.id) setGeneration(previous => previous?.id === receipt.id ? acceptGenerationReceipt(current.current?.id, previous, receipt) : previous)
            }).catch(reason => { if (mounted.current && current.current?.id === visibleGeneration.documentId) fail(reason) }) }}>{t('common.cancel')}</Button>}
          </div>
          {visibleGeneration?.sessionId && visibleGeneration.nodeId === node.id && props.onOpenSession && visibleGeneration.mode === 'agent' && !visibleGeneration.detached && <Button variant="ghost" onClick={() => props.onOpenSession?.(visibleGeneration.sessionId)}>{t('tasks.openSession')}</Button>}
          {context && <details open><summary className="text-sm">{t('thought.context')}</summary>{context.mode === 'agent' && <p className="my-2 text-xs text-muted-foreground">{t('thought.contextHint')}</p>}<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{workbenchContextPreview(context)}</pre><ul className="space-y-1 text-xs">{context.materials.filter(material => material.mimeType.startsWith('image/')).map(material => <li key={material.id} className="break-all">{material.name} · {material.digest}</li>)}</ul></details>}
          {visibleGeneration?.nodeId === node.id && <ThoughtGenerationOutput generation={visibleGeneration} />}
          {node.answer && <div className="border-t pt-3"><Markdown>{node.answer}</Markdown></div>}
          {persistedDocumentId && <ThoughtGenerationHistory key={`generation:${persistedDocumentId}:${node.id}`} documentId={persistedDocumentId} nodeId={node.id} revision={`${generation?.id}:${generation?.status}`} request={request} onOpenSession={props.onOpenSession} />}
          {node.kind === 'question' && <Button variant="outline" disabled={busy || running || node.archived} onClick={() => setAnswerDraft({ nodeId: node.id, answer: node.answer })}>{t('thought.reviseAnswer')}</Button>}
          {answerDraft?.nodeId === node.id && <div className="space-y-2">
            <textarea aria-label={t('thought.reviseAnswer')} className={`${fieldClass} min-h-40`} value={answerDraft.answer} disabled={busy || running} onChange={event => setAnswerDraft({ nodeId: node.id, answer: event.target.value })} />
            <Button disabled={busy || running} onClick={() => void reviseAnswer()}>{t('common.save')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAnswerDraft(null)}>{t('common.cancel')}</Button>
          </div>}
          {!!node.answer && <details><summary className="text-sm">{t('thought.highlights')}</summary>
            <textarea aria-label={t('thought.highlights')} className={`${fieldClass} mt-2 min-h-28`} readOnly value={node.answer} onSelect={event => {
              const element = event.currentTarget
              setHighlightSelection({ nodeId: node.id, text: node.answer.slice(element.selectionStart, element.selectionEnd) })
            }} />
            <Button variant="ghost" disabled={busy || running || highlightSelection?.nodeId !== node.id || !highlightSelection.text} onClick={() => {
              if (highlightSelection?.nodeId === node.id && highlightSelection.text && !node.highlights.includes(highlightSelection.text)) changeNode({ highlights: [...node.highlights, highlightSelection.text] })
            }}>{t('thought.addHighlight')}</Button>
            <select aria-label={t('thought.highlights')} className={fieldClass} disabled={busy || running} value={node.highlightMode} onChange={event => changeNode({ highlightMode: event.target.value as ThoughtNode['highlightMode'] })}>
              <option value="off">{t('thought.highlightOff')}</option><option value="tag">{t('thought.highlightTag')}</option><option value="filter">{t('thought.highlightFilter')}</option>
            </select>
            {node.highlights.map((text, index) => <div key={index} className="flex items-start gap-2 text-xs"><p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text}</p><Button size="sm" variant="ghost" disabled={busy || running} onClick={() => changeNode({ highlights: node.highlights.filter((_, i) => i !== index) })}>{t('common.delete')}</Button></div>)}
          </details>}
          {node.source && <details><summary className="text-sm">{t('thought.source')}</summary><pre className="overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(node.source, null, 2)}</pre></details>}
          {availableMaterials.map(material => <div key={material.id} className="flex items-center gap-2 text-sm">
            <Button variant="ghost" onClick={() => setReaderMaterialId(readerMaterialId === material.id ? undefined : material.id)} className="min-w-0 flex-1 justify-start truncate">{material.name}</Button>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={busy || running || (!includedMaterials.has(material.id) && !node.excludedMaterialIds.includes(material.id))} checked={includedMaterials.has(material.id)} onChange={event => changeNode({ excludedMaterialIds: event.target.checked ? node.excludedMaterialIds.filter(id => id !== material.id) : [...node.excludedMaterialIds, material.id] })} />{t('thought.includeMaterial')}</label>
          </div>)}
          {availableMaterials.find(material => material.id === readerMaterialId) && <WorkbenchMaterialReader workspaceId={props.workspaceId} documentId={document.id} material={availableMaterials.find(material => material.id === readerMaterialId)!} disabled={busy || running} onQuote={quoteMaterial} />}
          <ThoughtAnswerHistory key={`answer:${document.id}:${node.id}`} node={node} disabled={busy || running || node.kind === 'result'} onApply={version => changeNode({ answer: version.answer, activeVersionId: version.id, highlights: [], highlightMode: 'off' })} />
          <div className="space-y-2 border-t pt-3">{document.edges.filter(edge => edge.target === node.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(edge => <div key={edge.id} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="max-w-28 truncate">{document.nodes.find(item => item.id === edge.source)?.question || edge.source}</span>
            <select aria-label={t('thought.reference')} disabled={running} value={edge.kind} onChange={event => edit({ ...document, edges: document.edges.map(item => item.id === edge.id ? { ...item, kind: event.target.value as 'context' | 'reference' } : item) })}>
              <option value="context">{t('thought.context')}</option><option value="reference">{t('thought.reference')}</option></select>
            {edge.kind === 'reference' && <select aria-label={t('thought.referenceDepth')} disabled={busy || running} value={edge.depth} onChange={event => edit({ ...document, edges: document.edges.map(item => item.id === edge.id ? { ...item, depth: event.target.value as 'quote' | 'full' } : item) })}>
              <option value="quote">{t('thought.referenceQuote')}</option><option value="full">{t('thought.referenceFull')}</option></select>}
            <label className="flex items-center gap-1">{t('thought.referenceOrder')}<input type="number" className="w-16 rounded border bg-background px-1 py-1" disabled={busy || running} value={edge.order} onChange={event => {
              const order = event.target.valueAsNumber
              if (Number.isFinite(order)) edit({ ...document, edges: document.edges.map(item => item.id === edge.id ? { ...item, order } : item) })
            }} /></label>
            <Button size="sm" variant="ghost" disabled={running} onClick={() => edit({ ...document, edges: document.edges.filter(item => item.id !== edge.id) })}>{t('common.delete')}</Button>
          </div>)}</div>
          <Button variant="outline" disabled={running} onClick={async () => {
            try { const compiled = await compileThoughtContext(document, node.id); props.onPropose([...compiled.messages.map(message => message.content), node.answer].filter(Boolean).join('\n\n')) } catch (reason) { fail(reason) }
          }}>{t('tasks.proposalGenerate')}</Button>
          <Button variant="ghost" disabled={running} onClick={() => changeNode({ archived: !node.archived })}>{node.archived ? t('thought.restore') : t('thought.archive')}</Button>
        </>}
      </aside>
    </div>
  </div>
}
