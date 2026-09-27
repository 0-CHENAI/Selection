import { join } from 'node:path'
import { resolveArtifact } from '@craft-agent/shared/tasks'

export interface TaskDeliveryReceipt {
  version: 1
  outputs: Record<string, string>
  hashes: Record<string, string | null>
  checks: string[]
  transactionId?: string
}

/** Validate persisted identity before recovery is allowed to write anything. */
export function assertTaskDeliveryIdentity(requested: Record<string, string>, receipt: TaskDeliveryReceipt): void {
  if (!receipt || receipt.version !== 1 || !receipt.outputs || !receipt.hashes
    || typeof receipt.outputs !== 'object' || Array.isArray(receipt.outputs)
    || typeof receipt.hashes !== 'object' || Array.isArray(receipt.hashes)
    || !Array.isArray(receipt.checks) || !receipt.checks.every(check => typeof check === 'string')
    || Object.keys(requested).length !== Object.keys(receipt.outputs).length
    || Object.entries(requested).some(([name, path]) => typeof path !== 'string'
      || !Object.hasOwn(receipt.outputs, name) || receipt.outputs[name] !== path
      || !Object.hasOwn(receipt.hashes, path) || typeof receipt.hashes[path] !== 'string'
      || !/^[a-f0-9]{64}$/.test(receipt.hashes[path]!))) {
    throw new Error('Task delivery receipt does not match requested outputs')
  }
}

/** Rebuild public metadata only when persisted delivery identity still matches. */
export function replayTaskDelivery(root: string, requested: Record<string, string>, receipt: TaskDeliveryReceipt): Record<string, unknown> {
  assertTaskDeliveryIdentity(requested, receipt)
  return Object.fromEntries(Object.entries(requested).map(([name, path]) => {
    const result = resolveArtifact(root, undefined, path)
    if (!result.ok) throw new Error(result.error)
    if (!Object.hasOwn(receipt.hashes, path) || result.artifact.hash !== receipt.hashes[path]) throw new Error('Integrated output changed before delivery')
    return [name, { ...result.artifact, path: join(root, result.artifact.path), artifactDeliveryVersion: 1 }]
  }))
}
