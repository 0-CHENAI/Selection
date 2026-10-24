import type { PptRevisionTarget } from '@craft-agent/shared/protocol'

type Listener = () => void
let owner = ''
let targets: PptRevisionTarget[] = []
const listeners = new Set<Listener>()

export function getPptSelection(sessionId: string): PptRevisionTarget[] {
  return owner === sessionId ? targets : []
}

export function setPptSelection(sessionId: string, next: PptRevisionTarget[]): void {
  owner = sessionId
  targets = next
  for (const listener of listeners) listener()
}

export function subscribePptSelection(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
