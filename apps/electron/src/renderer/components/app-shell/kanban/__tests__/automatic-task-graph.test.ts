import { describe, expect, it, mock } from 'bun:test'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import type { TaskRunInspection } from '@craft-agent/shared/tasks'
import { automaticTaskGraphKey, currentTaskNodeResults, readAutomaticTaskGraph } from '../automatic-task-graph'
import { autoLayout, specToGraph } from '../conductor-graph'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const { toTaskGraph } = await import('../ConductorWorkbench')

const spec = { id: 'minimal', nodes: [
  { id: 'start', title: 'Prepare', prompt: 'Prepare input' },
  { id: 'official', title: 'Official', depends_on: ['start'] },
  { id: 'community', title: 'Community', depends_on: ['start'] },
  { id: 'report', title: 'Report', depends_on: ['official', 'community'] },
] }
const run: TaskRunSnapshotDto = { slug: 'minimal', runId: 'run-1', taskId: 'minimal', orchestratorSessionId: 'root', revision: 2, status: 'running', tokensUsed: 0,
  nodes: [{ id: 'start', state: 'done', attempt: 1 }, { id: 'official', state: 'running', attempt: 1 }, { id: 'community', state: 'failed', attempt: 1 }, { id: 'report', state: 'pending', attempt: 0 }] }
const inspection = { readOnly: true, spec, snapshot: run } as unknown as TaskRunInspection

describe('minimal automatic task graph', () => {
  it('reads the requested exact revision, not an authored replacement', async () => {
    const calls: unknown[] = []
    const actual = await readAutomaticTaskGraph(async (...args) => { calls.push(args); return inspection }, 'workspace', run)
    expect(actual).toBe(inspection.spec!)
    expect(calls).toEqual([['workspace', 'minimal', 'run-1']])
  })
  it.each([
    { ...inspection, spec: null },
    { ...inspection, readOnly: false },
    { ...inspection, snapshot: { ...run, runId: 'another' } },
    { ...inspection, snapshot: { ...run, revision: 1 } },
    { ...inspection, snapshot: { ...run, orchestratorSessionId: 'other-root' } },
  ])('rejects missing, foreign or stale run definitions', async value => {
    await expect(readAutomaticTaskGraph(async () => value as TaskRunInspection, 'workspace', run)).rejects.toThrow('exact task run revision')
  })
  it('keeps the key stable across live states and changes it at revision or session boundaries', () => {
    expect(automaticTaskGraphKey('workspace', run)).toBe(automaticTaskGraphKey('workspace', { ...run, status: 'completed', nodes: [] }))
    expect(automaticTaskGraphKey('workspace', run)).not.toBe(automaticTaskGraphKey('workspace', { ...run, revision: 3 }))
    expect(automaticTaskGraphKey('workspace', run)).not.toBe(automaticTaskGraphKey('other-workspace', run))
  })
  it('preserves a parallel fork/join and folds dynamic instances without moving nodes', () => {
    const graph = autoLayout(specToGraph(spec), 'TB', { width: 248, height: 128 })
    const first = toTaskGraph(graph, spec, run)
    expect(first.edges.map(e => [e.source, e.target])).toEqual([['start', 'official'], ['start', 'community'], ['official', 'report'], ['community', 'report']])
    const next = toTaskGraph(graph, spec, { ...run, nodes: [...run.nodes.filter(n => n.id !== 'official'), { id: 'official#0', state: 'done', attempt: 1 }, { id: 'official#1', state: 'waiting-help', attempt: 1 }] })
    expect(next.nodes.map(n => n.position)).toEqual(first.nodes.map(n => n.position))
    expect(next.nodes.find(n => n.id === 'official')?.data.instanceCount).toBe(2)
    expect(next.nodes.find(n => n.id === 'official')?.data.state).toBe('waiting-help')
  })
  it('does not present another run, owner or retry output as current results', () => {
    const instances = [{ id: 'official', state: 'done', attempt: 2, sessionId: 'current-child', attempts: [{ attempt: 2, revision: 1, sessionId: 'current-child', state: 'done' }] }]
    const results = { slug: run.slug, runId: run.runId, runIds: [run.runId], revision: run.revision, nodes: [
      { id: 'official', title: 'Official', state: 'done', attempt: 1, revision: 0, output: 'outdated' },
      { id: 'official', title: 'Official', state: 'done', attempt: 2, revision: 1, sessionId: 'current-child', output: 'current' },
    ] }
    expect(currentTaskNodeResults(results, run, instances).map(node => node.output)).toEqual(['current'])
    expect(currentTaskNodeResults({ ...results, runId: 'other' }, run, instances)).toEqual([])
    expect(currentTaskNodeResults({ ...results, revision: 0 }, run, instances)).toEqual([])
    expect(currentTaskNodeResults({ ...results, orchestratorSessionId: 'other' }, run, instances)).toEqual([])
    expect(currentTaskNodeResults({ ...results, nodes: [{ ...results.nodes[1]!, sessionId: 'old-child' }] }, run, instances)).toEqual([])
  })
})
