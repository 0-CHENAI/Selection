import * as React from 'react'

/** The source-to-target path carries flowing dashes and a fixed arrowhead. */
export function TaskFlowEdge({ path, color, active, label, labelX, labelY }: {
  path: string; color: string; active: boolean; label?: string; labelX: number; labelY: number
}) {
  const marker = React.useId().replace(/:/g, '')
  return <g className="task-flow-edge" aria-hidden="true">
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </marker></defs>
    <path className="task-flow-edge-path" d={path} fill="none" stroke={color} strokeWidth={active ? 1.8 : 1.5} markerEnd={`url(#${marker})`} />
    {label && <text x={labelX} y={labelY - 8} textAnchor="middle" className="task-flow-edge-label">{label}</text>}
  </g>
}
