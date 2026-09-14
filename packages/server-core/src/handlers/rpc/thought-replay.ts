import type { ThoughtGeneration, ThoughtReplay } from '@craft-agent/shared/thought-workbench/types'

export interface ReplayDependencies {
  persist(replay: ThoughtReplay): void
  start(nodeId: string): Promise<{ generationId: string; finished: Promise<ThoughtGeneration> }>
  cancel(generationId: string): Promise<void>
}

/** A serial, explicit queue. Persistence precedes dispatch and every terminal transition. */
export function runThoughtReplay(replay: ThoughtReplay, dependencies: ReplayDependencies) {
  dependencies.persist(replay)
  let cancelled = false
  const finished = (async () => {
    try {
      for (const nodeId of replay.nodeIds) {
        if (cancelled) break
        const generation = await dependencies.start(nodeId)
        replay.generationId = generation.generationId
        if (cancelled) {
          await dependencies.cancel(generation.generationId)
          break
        }
        dependencies.persist(replay)
        const result = await generation.finished
        if (cancelled) break
        if (result.status !== 'completed') throw new Error(result.error || `Replay generation ${result.status}`)
        replay.completedNodeIds.push(nodeId)
        replay.generationId = undefined
        dependencies.persist(replay)
      }
      if (!cancelled) replay.status = 'completed'
    } catch (error) {
      if (!cancelled) {
        replay.status = 'failed'
        replay.error = error instanceof Error ? error.message : String(error)
      }
      // A dispatch may already exist when persistence fails. Stop it before exiting.
      if (replay.generationId) await dependencies.cancel(replay.generationId).catch(() => {})
    } finally {
      dependencies.persist(replay)
    }
    return replay
  })()
  return {
    replay,
    finished,
    async cancel() {
      if (replay.status !== 'running') return
      cancelled = true
      replay.status = 'interrupted'
      try { dependencies.persist(replay) }
      finally { if (replay.generationId) await dependencies.cancel(replay.generationId) }
    },
  }
}
