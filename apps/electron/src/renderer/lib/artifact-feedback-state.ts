import type { ArtifactFeedback } from '@craft-agent/shared/protocol'

/** Runtime revisions order persisted updates even when clocks collide or move backwards. */
export function latestArtifactFeedback(current: ArtifactFeedback, incoming: ArtifactFeedback): ArtifactFeedback {
  if (current.id !== incoming.id) return incoming
  if (current.revision !== undefined || incoming.revision !== undefined) {
    return (incoming.revision ?? 0) > (current.revision ?? 0) ? incoming : current
  }
  return incoming.updatedAt > current.updatedAt ? incoming : current
}

export function mergeArtifactFeedbackHistory(current: ArtifactFeedback[], incoming: ArtifactFeedback[]): ArtifactFeedback[] {
  const merged = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    const previous = merged.get(item.id)
    merged.set(item.id, previous ? latestArtifactFeedback(previous, item) : item)
  }
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

/** Background responses update the selected request without switching the user's selection. */
export function updateSelectedArtifactFeedback(current: ArtifactFeedback | undefined, incoming: ArtifactFeedback): ArtifactFeedback | undefined {
  return current?.id === incoming.id ? latestArtifactFeedback(current, incoming) : current
}
