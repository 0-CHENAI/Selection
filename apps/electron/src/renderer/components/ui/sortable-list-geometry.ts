import { closestCenter, pointerWithin, type CollisionDetection, type Modifier } from '@dnd-kit/core'

export const verticalAxisOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export const restrictToContainer: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return transform
  // dnd-kit rounds CSS translations to whole pixels; round inward so that
  // subpixel geometry cannot push the element slightly past either edge.
  const minY = Math.ceil(containerNodeRect.top - draggingNodeRect.top)
  const maxY = Math.floor(containerNodeRect.bottom - draggingNodeRect.bottom)
  return { ...transform, y: Math.max(minY, Math.min(maxY, transform.y)) }
}

// Pointer position identifies the intended row even when the dragged row is
// taller than its neighbours (for example, an expanded settings form).
export const boundedCollisionDetection: CollisionDetection = (args) => {
  const entries = args.droppableContainers.flatMap(container => {
    const rect = args.droppableRects.get(container.id)
    return rect ? [{ container, rect }] : []
  })
  if (!entries.length) return []
  const top = Math.min(...entries.map(({ rect }) => rect.top))
  const bottom = Math.max(...entries.map(({ rect }) => rect.bottom))
  const left = Math.min(...entries.map(({ rect }) => rect.left))
  const right = Math.max(...entries.map(({ rect }) => rect.right))
  const activeRect = args.droppableRects.get(args.active.id)
  const delta = activeRect ? args.collisionRect.top - activeRect.top : 0
  // Keyboard sorting has no pointer. Use the leading edge so a tall expanded
  // row can move by one position without its centre remaining over itself.
  const anchor = args.pointerCoordinates ?? {
    x: (args.collisionRect.left + args.collisionRect.right) / 2,
    y: delta < -1 ? args.collisionRect.top + 0.5
      : delta > 1 ? args.collisionRect.bottom - 0.5
        : (args.collisionRect.top + args.collisionRect.bottom) / 2,
  }
  const point = {
    x: Math.max(left + 0.5, Math.min(right - 0.5, anchor.x)),
    y: Math.max(top + 0.5, Math.min(bottom - 0.5, anchor.y)),
  }
  const collisions = pointerWithin({ ...args, pointerCoordinates: point })
  if (collisions.length) return collisions
  return closestCenter(args)
}
