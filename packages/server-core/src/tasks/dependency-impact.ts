/** Shared impact calculation for retries and invalidated upstream artifacts.
 * Roots are included; unrelated branches retain their existing results.
 */
export function dependencyImpact(
  roots: ReadonlySet<string>,
  nodes: readonly { id: string; kind?: string }[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const affected = new Set(roots)
  const downstream = new Map<string, string[]>()
  for (const node of nodes) {
    const dependencies = edges.get(node.id)
    for (const dependency of dependencies ?? []) {
      const children = downstream.get(dependency) ?? []
      children.push(node.id)
      downstream.set(dependency, children)
    }
    // An unscoped finalizer consumes the whole run, including any changed root.
    if (roots.size && node.kind === 'finally' && !dependencies?.size) affected.add(node.id)
  }
  const pending = [...affected]
  for (let index = 0; index < pending.length; index++) {
    for (const child of downstream.get(pending[index]!) ?? []) {
      if (affected.has(child)) continue
      affected.add(child)
      pending.push(child)
    }
  }
  return affected
}

/** All upstream inputs, including artifacts consumed through intermediate text. */
export function dependencyAncestors(nodeId: string, edges: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const visited = new Set<string>([nodeId])
  const pending = [...(edges.get(nodeId) ?? [])]
  const ancestors = new Set<string>()
  for (let index = 0; index < pending.length; index++) {
    const dependency = pending[index]!
    if (visited.has(dependency)) continue
    visited.add(dependency)
    ancestors.add(dependency)
    pending.push(...(edges.get(dependency) ?? []))
  }
  return ancestors
}
