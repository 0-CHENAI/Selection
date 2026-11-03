import { describe, expect, it } from 'bun:test'
import { boundedCollisionDetection, restrictToContainer, verticalAxisOnly } from './sortable-list-geometry'

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200, width: 200, height: bottom - top })
const transform = { x: 37, y: 0, scaleX: 1, scaleY: 1 }

describe('bounded sortable list geometry', () => {
  it('keeps subpixel element bounds inside the list and locks the horizontal axis', () => {
    const geometry = { draggingNodeRect: rect(120.4, 319.6), containerNodeRect: rect(0.25, 500.25) }
    const up = restrictToContainer({ ...geometry, transform: { ...transform, y: -1000 } } as any)
    const down = restrictToContainer({ ...geometry, transform: { ...transform, y: 1000 } } as any)
    expect(up.y + 120.4).toBeGreaterThanOrEqual(0.25)
    expect(down.y + 319.6).toBeLessThanOrEqual(500.25)
    expect(verticalAxisOnly({ transform } as any).x).toBe(0)
  })

  it('reaches the last row with a tall expanded row and an out-of-bounds pointer', () => {
    const containers = ['native', 'expanded', 'last'].map(id => ({ id, data: { current: {} }, disabled: false }))
    const rects = new Map([['native', rect(0, 60)], ['expanded', rect(60, 260)], ['last', rect(260, 320)]])
    const args = { droppableContainers: containers, droppableRects: rects, active: { id: 'expanded' }, collisionRect: rect(120, 320), pointerCoordinates: { x: 500, y: 800 } } as any
    expect(boundedCollisionDetection(args)[0]?.id).toBe('last')
  })

  it('uses the leading edge for keyboard moves of a tall expanded row', () => {
    const containers = ['before', 'expanded', 'after'].map(id => ({ id, data: { current: {} }, disabled: false }))
    const rects = new Map([['before', rect(0, 60)], ['expanded', rect(60, 260)], ['after', rect(260, 320)]])
    const base = { droppableContainers: containers, droppableRects: rects, active: { id: 'expanded' }, pointerCoordinates: null }
    expect(boundedCollisionDetection({ ...base, collisionRect: rect(0, 200) } as any)[0]?.id).toBe('before')
    expect(boundedCollisionDetection({ ...base, collisionRect: rect(120, 320) } as any)[0]?.id).toBe('after')
  })
})
