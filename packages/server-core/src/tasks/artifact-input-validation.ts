import { dependencyAncestors } from './dependency-impact'
import { isAbsolute, dirname, basename, resolve } from 'node:path'
import { verifyArtifact, type NodeOutput, type TaskNode } from '@craft-agent/shared/tasks'

/** Recheck declared artifact receipts immediately before a consumer runs. */
function artifactInputs(
  workspaceRoot: string,
  dependencies: ReadonlySet<string>,
  nodes: readonly TaskNode[],
  outputs: Readonly<Record<string, NodeOutput>>,
  edges: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Array<{ nodeId: string; name: string; value: unknown }> {
  // Map/replica outputs store each instance's params in `items`; their
  // declarations apply to every item, not to the aggregate envelope.
  const normalizedOutputs = { ...outputs }
  nodes = nodes.map(node => {
    const items = outputs[node.id]?.params?.items
    if (!(node.kind === 'map' || node.replicas) || !Array.isArray(items)) return node
    const params: Record<string, unknown> = {}
    const declarations: NonNullable<TaskNode['outputs']> = []
    items.forEach((item, index) => {
      for (const declaration of node.outputs ?? []) {
        if (declaration.kind !== 'artifact') continue
        const name = `${declaration.name}[${index}]`
        declarations.push({ ...declaration, name })
        params[name] = item && typeof item === 'object' ? item[declaration.name] : undefined
      }
    })
    normalizedOutputs[node.id] = { text: '', params }
    return { ...node, outputs: declarations }
  })
  nodes = nodes.map(node => {
    const receipts = outputs[node.id]?.integratedArtifacts
    if (!receipts) return node
    const declarations = [...(node.outputs ?? [])]
    for (const name of Object.keys(receipts)) if (!declarations.some(item => item.name === name)) declarations.push({ name, kind: 'artifact' })
    normalizedOutputs[node.id] = { ...normalizedOutputs[node.id]!, params: { ...normalizedOutputs[node.id]?.params, ...receipts } }
    return { ...node, outputs: declarations }
  })
  outputs = normalizedOutputs
  const selected: Array<{ nodeId: string; name: string; value: unknown }> = []
  const ancestors = new Map<string, Set<string>>()
  for (const id of dependencies) ancestors.set(id, dependencyAncestors(id, edges))
  const identity = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const receipt = value as { path?: unknown; artifactDeliveryVersion?: unknown }
    if (typeof receipt.path !== 'string') return undefined
    if (isAbsolute(receipt.path) && receipt.artifactDeliveryVersion !== 1) return undefined
    return resolve(workspaceRoot, receipt.path)
  }
  for (const node of nodes) {
    if (!dependencies.has(node.id)) continue
    const output = outputs[node.id]
    for (const declaration of node.outputs ?? []) {
      if (declaration.kind !== 'artifact') continue
      const value = output?.params?.[declaration.name]
      if (value === undefined && declaration.required === false) continue
      const path = identity(value)
      // Only a downstream producer can supersede a receipt. Parallel producers
      // remain independently checked; iteration order never picks a winner.
      const superseded = path !== undefined && nodes.some(later => dependencies.has(later.id)
        && ancestors.get(later.id)?.has(node.id) && !ancestors.get(node.id)?.has(later.id)
        && later.outputs?.some(output => output.kind === 'artifact' && identity(outputs[later.id]?.params?.[output.name]) === path))
      if (superseded) continue
      selected.push({ nodeId: node.id, name: declaration.name, value })
    }
  }
  return selected
}

export function invalidArtifactInput(workspaceRoot: string, dependencies: ReadonlySet<string>, nodes: readonly TaskNode[], outputs: Readonly<Record<string, NodeOutput>>, edges: ReadonlyMap<string, ReadonlySet<string>> = new Map()): string | undefined {
  for (const { nodeId, name, value } of artifactInputs(workspaceRoot, dependencies, nodes, outputs, edges)) {
    const receipt = value as { artifactDeliveryVersion?: number; path?: string } | undefined
    const integrated = receipt?.artifactDeliveryVersion === 1 && typeof receipt.path === 'string' && isAbsolute(receipt.path)
    const result = integrated ? verifyArtifact(dirname(receipt.path!), { ...receipt, path: basename(receipt.path!) }) : verifyArtifact(workspaceRoot, value)
    if (!result.ok) return `Upstream artifact ${nodeId}.${name}: ${result.error}`
  }
}

/** Minimal immutable input snapshot; never includes assistant prose or file bytes. */
export function captureArtifactInputs(dependencies: ReadonlySet<string>, nodes: readonly TaskNode[], outputs: Readonly<Record<string, NodeOutput>>, workspaceRoot = '.', edges: ReadonlyMap<string, ReadonlySet<string>> = new Map()): Record<string, NodeOutput> {
  const captured: Record<string, NodeOutput> = {}
  for (const { nodeId, name, value } of artifactInputs(workspaceRoot, dependencies, nodes, outputs, edges)) {
    const output = captured[nodeId] ??= { text: '', params: {} }
    const receipt = value as Record<string, unknown> | undefined
    output.params![name] = receipt && typeof receipt === 'object'
      ? { path: receipt.path, hash: receipt.hash, size: receipt.size,
        ...(receipt.artifactDeliveryVersion === 1 ? { artifactDeliveryVersion: 1 } : {}) }
      : null
  }
  return captured
}

/** Frozen receipt names are authoritative even if a later revision removes declarations. */
export function artifactInputSnapshotError(inputs: Readonly<Record<string, NodeOutput>>): string | undefined {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return 'Invalid artifact input snapshot'
  for (const [id, output] of Object.entries(inputs)) {
    if (!id || !output || typeof output !== 'object' || Array.isArray(output)
      || typeof output.text !== 'string' || !output.params || typeof output.params !== 'object'
      || Array.isArray(output.params) || Object.keys(output.params).length === 0) {
      return `Invalid artifact input snapshot for ${id}`
    }
  }
}

export function invalidFrozenArtifactInput(workspaceRoot: string, inputs: Readonly<Record<string, NodeOutput>>): string | undefined {
  const error = artifactInputSnapshotError(inputs)
  if (error) return error
  const nodes = Object.entries(inputs).map(([id, output]) => ({ id, kind: 'session' as const,
    outputs: Object.keys(output.params ?? {}).map(name => ({ name, kind: 'artifact' as const })) }))
  return invalidArtifactInput(workspaceRoot, new Set(Object.keys(inputs)), nodes, inputs)
}
