import { describe, expect, it } from 'bun:test'
import {
  createFileDragDepth,
  droppedFilesFromDataTransfer,
  hasFileDragType,
  installExternalFileWindowGuard,
  isPointOutsideRect,
  preventExternalFileNavigation,
  shouldResetFileDragOnLeave,
} from '../external-file-drag'

describe('hasFileDragType', () => {
  it('recognizes file drags from array-like Windows/Electron type lists', () => {
    const domStringListLike = { 0: 'Files', length: 1 }
    expect(hasFileDragType(domStringListLike)).toBe(true)
    expect(hasFileDragType(['text/plain', 'FILES'])).toBe(true)
    expect(hasFileDragType(['text/plain'])).toBe(false)
    expect(hasFileDragType(null)).toBe(false)
  })
})

describe('droppedFilesFromDataTransfer', () => {
  it('returns the File list the composer already consumes', () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    expect(droppedFilesFromDataTransfer({ files: [file] } as unknown as DataTransfer)).toEqual([file])
    expect(droppedFilesFromDataTransfer(null)).toEqual([])
  })
})

describe('createFileDragDepth', () => {
  it('ignores non-file drags and stays active across child enter/leave flicker', () => {
    const drag = createFileDragDepth()
    expect(drag.enter(['text/plain'])).toBe(false)
    expect(drag.active).toBe(false)

    expect(drag.enter(['Files'])).toBe(true)
    expect(drag.enter(['Files'])).toBe(true)
    expect(drag.depth).toBe(2)
    expect(drag.leave()).toBe(true)
    expect(drag.active).toBe(true)
    expect(drag.leave()).toBe(false)
    expect(drag.active).toBe(false)
  })

  it('resets on drop, escape, or a cancelled drag', () => {
    const drag = createFileDragDepth()
    drag.enter(['Files'])
    drag.enter(['Files'])
    drag.reset()
    expect(drag.active).toBe(false)
    expect(drag.depth).toBe(0)
  })
})

describe('isPointOutsideRect', () => {
  const rect = { left: 10, top: 10, right: 100, bottom: 80 }

  it('treats a pointer on or past the edge as having left the pane', () => {
    expect(isPointOutsideRect({ clientX: 50, clientY: 40 }, rect)).toBe(false)
    expect(isPointOutsideRect({ clientX: 10, clientY: 40 }, rect)).toBe(true)
    expect(isPointOutsideRect({ clientX: 50, clientY: 80 }, rect)).toBe(true)
  })
})

describe('shouldResetFileDragOnLeave', () => {
  const rect = { left: 0, top: 0, right: 400, bottom: 300 }

  it('clears when the drag leaves the window and keeps state when moving to a child', () => {
    expect(shouldResetFileDragOnLeave({ relatedTarget: {} as Node, clientX: -1, clientY: 10 }, rect)).toBe(false)
    expect(shouldResetFileDragOnLeave({ relatedTarget: null, clientX: 20, clientY: 20 }, rect)).toBe(false)
    expect(shouldResetFileDragOnLeave({ relatedTarget: null, clientX: -1, clientY: 10 }, rect)).toBe(true)
  })
})

describe('installExternalFileWindowGuard', () => {
  it('prevents default only for external file drags', () => {
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      },
    }

    const uninstall = installExternalFileWindowGuard(target)
    const fileOver = {
      type: 'dragover',
      dataTransfer: { types: ['Files'], dropEffect: 'copy' },
      prevented: false,
      preventDefault() { this.prevented = true },
    }
    const fileDrop = {
      type: 'drop',
      dataTransfer: { types: ['Files'], dropEffect: 'copy' },
      prevented: false,
      preventDefault() { this.prevented = true },
    }
    const textEvent = {
      type: 'dragover',
      dataTransfer: { types: ['text/plain'], dropEffect: 'copy' },
      prevented: false,
      preventDefault() { this.prevented = true },
    }

    listeners.get('dragover')?.(fileOver as unknown as Event)
    listeners.get('drop')?.(fileDrop as unknown as Event)
    listeners.get('dragover')?.(textEvent as unknown as Event)
    expect(fileOver.prevented).toBe(true)
    expect(fileOver.dataTransfer.dropEffect).toBe('none')
    expect(fileDrop.prevented).toBe(true)
    expect(textEvent.prevented).toBe(false)

    uninstall()
    expect(listeners.size).toBe(0)
  })
})

describe('preventExternalFileNavigation', () => {
  it('no-ops when dataTransfer is missing', () => {
    const event = { preventDefault() { throw new Error('should not prevent') } }
    expect(() => preventExternalFileNavigation(event as unknown as Event)).not.toThrow()
  })
})
