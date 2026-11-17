/** Detect OS / Electron file drags. `types` may be a DOMStringList. */
export function hasFileDragType(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false
  return Array.from(types).some(type => type.toLowerCase() === 'files')
}

/** Same File list the composer drop path already consumes. */
export function droppedFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data?.files) return []
  return Array.from(data.files)
}

export function isPointOutsideRect(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  return point.clientX <= rect.left
    || point.clientY <= rect.top
    || point.clientX >= rect.right
    || point.clientY >= rect.bottom
}

/**
 * Depth counter for dragenter/dragleave flicker from child elements.
 * Pair every enter with a leave; do not mix in relatedTarget skipping.
 */
export function createFileDragDepth() {
  let depth = 0
  return {
    get depth() {
      return depth
    },
    get active() {
      return depth > 0
    },
    enter(types: ArrayLike<string> | null | undefined): boolean {
      if (!hasFileDragType(types)) return depth > 0
      depth += 1
      return true
    },
    leave(): boolean {
      depth = Math.max(0, depth - 1)
      return depth > 0
    },
    reset() {
      depth = 0
    },
  }
}

/** Safety net for cancelled OS drags and leaving the window. */
export function shouldResetFileDragOnLeave(
  event: { relatedTarget: EventTarget | null; clientX: number; clientY: number },
  root: { left: number; top: number; right: number; bottom: number },
): boolean {
  if (event.relatedTarget) return false
  return isPointOutsideRect(event, root)
}

export function preventExternalFileNavigation(event: Event): void {
  const drag = event as DragEvent
  if (!hasFileDragType(drag.dataTransfer?.types)) return
  event.preventDefault()
  // Default the window to "not a drop target"; pane/composer handlers
  // overwrite this with `copy` while the drag is over them.
  if (event.type === 'dragover' && drag.dataTransfer) {
    drag.dataTransfer.dropEffect = 'none'
  }
}

type ListenerTarget = {
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void
}

/** Stop Chromium/Electron from navigating to a dropped file anywhere in this window. */
export function installExternalFileWindowGuard(target: ListenerTarget = window): () => void {
  target.addEventListener('dragover', preventExternalFileNavigation, true)
  target.addEventListener('drop', preventExternalFileNavigation, true)
  return () => {
    target.removeEventListener('dragover', preventExternalFileNavigation, true)
    target.removeEventListener('drop', preventExternalFileNavigation, true)
  }
}
