import type { ThoughtGeneration } from '@craft-agent/shared/thought-workbench/types'

/** RPC acknowledgements can arrive after a switch, a cancellation, or a newer event. */
export function acceptGenerationReceipt(documentId: string | undefined, previous: ThoughtGeneration | null, receipt: ThoughtGeneration): ThoughtGeneration | null {
  if (receipt.documentId !== documentId) return previous
  if (previous?.id === receipt.id) return isNewerGeneration(previous, receipt) ? receipt : previous
  if (previous?.documentId === documentId && previous.status === 'running') return previous
  return receipt
}

export function isNewerGeneration(previous: ThoughtGeneration, next: ThoughtGeneration): boolean {
  if (previous.id !== next.id || previous.documentId !== next.documentId || previous.nodeId !== next.nodeId) return false
  if (previous.status !== 'running' && next.status === 'running') return false
  return next.sequence === undefined
    ? previous.sequence === undefined
    : next.sequence > (previous.sequence ?? -1)
}

/** Observation only: never resumes interrupted model or tool execution. */
export function recoverLiveGeneration(documentId: string, previous: ThoughtGeneration | null, receipts: ThoughtGeneration[]): ThoughtGeneration | null {
  if (previous?.documentId === documentId && previous.status === 'running') return previous
  return receipts.find(receipt => receipt.documentId === documentId && receipt.status === 'running')
    ?? (previous?.documentId === documentId ? previous : null)
}
