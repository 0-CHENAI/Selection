/**
 * Clone a task definition for a new slug. Copies the authored DAG only —
 * run state, child sessions, and quick-add (`qa-`) nodes stay behind.
 */
import type { TaskNode, TaskSpec } from './schema.ts';

const QUICK_ADD_PREFIX = 'qa-';

function scrubNode(node: TaskNode, drop: ReadonlySet<string>): TaskNode {
  const { depends_on: _prev, ...rest } = node;
  const depends_on = node.depends_on?.filter((id) => !drop.has(id));
  let next: TaskNode = depends_on && depends_on.length > 0 ? { ...rest, depends_on } : rest;

  if (next.route) {
    const cases = next.route.cases.filter((c) => !drop.has(c.goto));
    if (cases.length === 0 || drop.has(next.route.default)) {
      const { route: _route, ...withoutRoute } = next;
      next = withoutRoute;
    } else {
      next = { ...next, route: { ...next.route, cases } };
    }
  }

  if (next.loop?.else && drop.has(next.loop.else)) {
    const { else: _else, ...loop } = next.loop;
    next = { ...next, loop };
  }

  return next;
}

export function cloneTaskDefinition(
  spec: TaskSpec,
  next: { id: string; title: string },
): TaskSpec {
  const drop = new Set(spec.nodes.filter((n) => n.id.startsWith(QUICK_ADD_PREFIX)).map((n) => n.id));
  const nodes = spec.nodes.filter((n) => !drop.has(n.id)).map((n) => scrubNode(n, drop));
  if (nodes.length === 0) {
    throw new Error('Cannot clone a task that has no reusable nodes');
  }

  const params = spec.params?.map((param) => {
    if (!param.sensitive) return param;
    const { default: _omit, ...rest } = param;
    return rest;
  });

  let ui = spec.ui;
  if (ui?.layout?.nodes) {
    const layoutNodes = Object.fromEntries(
      Object.entries(ui.layout.nodes).filter(([id]) => !drop.has(id)),
    );
    ui = { ...ui, layout: { ...ui.layout, nodes: layoutNodes } };
  }

  return {
    ...spec,
    schema_version: 2,
    id: next.id,
    title: next.title,
    nodes,
    ...(params ? { params } : {}),
    ...(ui ? { ui } : {}),
  };
}
