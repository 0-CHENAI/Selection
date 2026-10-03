export interface ProposalChange { path: string; before: unknown; after: unknown }

/** Compare nodes by stable id, so inserting a node does not report every later node as replaced. */
export function taskProposalChanges(before: unknown, after: unknown): ProposalChange[] {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const normalize = (value: unknown): unknown => {
    if (!object(value)) return value
    return { ...value, ...(Array.isArray(value.nodes) ? { nodes: Object.fromEntries(value.nodes.map(node => [node.id, node])) } : {}) }
  }
  const changes: ProposalChange[] = []
  const visit = (left: unknown, right: unknown, path: string) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return
    if (object(left) && object(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(
        Object.hasOwn(left, key) ? left[key] : undefined,
        Object.hasOwn(right, key) ? right[key] : undefined,
        path ? `${path}.${key}` : key,
      )
    } else changes.push({ path, before: left, after: right })
  }
  visit(normalize(before), normalize(after), '')
  return changes
}
