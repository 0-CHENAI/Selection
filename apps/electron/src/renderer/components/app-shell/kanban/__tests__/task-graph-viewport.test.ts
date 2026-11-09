import { expect, it } from 'bun:test'
import { fitTaskGraph, zoomTaskGraph, taskGraphEdgePath } from '../task-graph-viewport'

it('fits the whole graph on desktop and narrow windows and keeps the zoom anchor fixed', () => {
  const bounds = { x: -80, y: 40, width: 656, height: 336 }
  for (const [width, height] of [[1200, 700], [390, 650]]) {
    const view = fitTaskGraph(bounds, width!, height!)
    expect(bounds.x * view.zoom + view.x).toBeGreaterThanOrEqual(32 - 1e-6)
    expect((bounds.x + bounds.width) * view.zoom + view.x).toBeLessThanOrEqual(width! - 32 + 1e-6)
    expect(bounds.y * view.zoom + view.y).toBeGreaterThanOrEqual(48 - 1e-6)
    expect((bounds.y + bounds.height) * view.zoom + view.y).toBeLessThanOrEqual(height! - 48 + 1e-6)
    const anchor = { x: 120, y: 180 }
    const next = zoomTaskGraph(view, 1.2, anchor.x, anchor.y)
    expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - view.x) / view.zoom)
    expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - view.y) / view.zoom)
  }
  expect(taskGraphEdgePath({ x: 288, y: 64 }, { x: 368, y: 232 }, 'LR').path).toMatch(/^M 288 64 .* L 368 232$/)
  expect(taskGraphEdgePath({ x: 144, y: 128 }, { x: 432, y: 208 }, 'TB').path).toMatch(/^M 144 128 .* L 432 208$/)
})
