import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { installRendererRecovery } from '../renderer-recovery'

function fixture() {
  let reloads = 0, prompts = 0
  let quitting = false
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    reload: () => { reloads++ },
  })
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: contents,
  })
  installRendererRecovery(window as unknown as BrowserWindow, () => quitting, () => {}, () => { prompts++ })
  return { window, contents, stop: () => { quitting = true }, counts: () => [reloads, prompts] }
}

describe('renderer crash recovery', () => {
  it('reloads the existing window and bounds repeated crashes', () => {
    const f = fixture()
    for (let i = 0; i < 3; i++) f.contents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(f.counts()).toEqual([2, 1])
  })
  it('does not reload during quit or after a clean exit and removes listeners on close', () => {
    const f = fixture()
    f.contents.emit('render-process-gone', {}, { reason: 'clean-exit' })
    f.stop()
    f.contents.emit('render-process-gone', {}, { reason: 'killed' })
    expect(f.counts()).toEqual([0, 0])
    f.window.emit('closed')
    expect(f.contents.listenerCount('render-process-gone')).toBe(0)
  })
})
