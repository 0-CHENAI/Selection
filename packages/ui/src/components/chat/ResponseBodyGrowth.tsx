import type { ReactNode } from 'react'

/** Grow in document flow. A height tween on each new block jitters the card. */
export function ResponseBodyGrowth({ children }: { streaming?: boolean; children: ReactNode }) {
  return <div data-response-body-growth="" className="flow-root">{children}</div>
}
