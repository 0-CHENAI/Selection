import type { TaskNodeRunStateDto } from '@craft-agent/shared/protocol'
import type { WorkbenchNode } from './ConductorWorkbench'

export function nodeDefinitionRows(node: WorkbenchNode): Array<{ key: string; labelKey: string; value: string }> {
  const rows: Array<{ key: string; labelKey: string; value: string }> = []
  if (node.title && node.title !== node.id) rows.push({ key: 'title', labelKey: 'tasks.title', value: node.title })
  if (node.depends_on?.length) rows.push({ key: 'depends', labelKey: 'tasks.nodeDependsOn', value: node.depends_on.join(', ') })
  if (node.permissionMode) rows.push({ key: 'permission', labelKey: 'tasks.nodePermission', value: node.permissionMode })
  if (node.model) rows.push({ key: 'model', labelKey: 'tasks.nodeModel', value: node.model })
  const outputs = node.outputs?.map((output) => output.name).filter(Boolean)
  if (outputs?.length) rows.push({ key: 'outputs', labelKey: 'tasks.nodeOutputs', value: outputs.join(', ') })
  if (node.for_each) rows.push({ key: 'for_each', labelKey: 'tasks.nodeControlFlow', value: `for_each: ${node.for_each}` })
  if (node.loop != null) rows.push({ key: 'loop', labelKey: 'tasks.nodeControlFlow', value: `loop: ${JSON.stringify(node.loop)}` })
  if (node.route != null) rows.push({ key: 'route', labelKey: 'tasks.nodeControlFlow', value: `route: ${JSON.stringify(node.route)}` })
  if (node.when != null) rows.push({ key: 'when', labelKey: 'tasks.nodeControlFlow', value: `when: ${JSON.stringify(node.when)}` })
  return rows
}

export function runtimeNodesForDefinition(nodes: TaskNodeRunStateDto[], nodeId: string): TaskNodeRunStateDto[] {
  return nodes.filter((node) => node.id === nodeId || node.definitionId === nodeId || node.id.startsWith(`${nodeId}#`))
}
