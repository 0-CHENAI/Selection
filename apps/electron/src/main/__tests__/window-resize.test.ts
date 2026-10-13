import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { trackWindowResize } from '../window-resize'
import { GET_WINDOW_RESIZE_STATE, WINDOW_RESIZE_STATE } from '../../shared/window-resize'

function fixture(platform: NodeJS.Platform = 'darwin') {
  const messages: unknown[][] = []
  const contents = {
    ipc: new EventEmitter(),
    mainFrame: {},
    isDestroyed: () => false,
    send: (...args: unknown[]) => messages.push(args),
  }
  const window = Object.assign(new EventEmitter(), { webContents: contents })
  trackWindowResize(window as unknown as BrowserWindow, platform)
  const query = () => contents.ipc.emit(GET_WINDOW_RESIZE_STATE, { senderFrame: contents.mainFrame })
  return { window, contents, messages, query }
}

describe('native window resize gesture', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    it(`${platform}: retains holding state until the gesture ends, without per-pixel pushes`, async () => {
      const { window, messages, query } = fixture(platform)
      window.emit('will-resize')
      for (let i = 0; i < 20; i++) window.emit('will-resize')
      expect(messages).toEqual([[WINDOW_RESIZE_STATE, true]])
      await Bun.sleep(220)
      query() // A preview mounting while the pointer is held gets true.
      expect(messages.at(-1)).toEqual([WINDOW_RESIZE_STATE, true])
      window.emit('resized')
      expect(messages.at(-1)).toEqual([WINDOW_RESIZE_STATE, false])
      query()
      expect(messages.at(-1)).toEqual([WINDOW_RESIZE_STATE, false])
      window.emit('closed')
      expect(window.listenerCount('will-resize')).toBe(0)
      expect(query()).toBe(false)
    })
  }

  it('isolates windows and ignores state queries from subframes', () => {
    const first = fixture(), second = fixture()
    first.window.emit('will-resize')
    first.contents.ipc.emit(GET_WINDOW_RESIZE_STATE, { senderFrame: {} })
    expect(first.messages).toHaveLength(1)
    second.query()
    expect(second.messages).toEqual([[WINDOW_RESIZE_STATE, false]])
  })

  it('does not treat programmatic resize events as a held gesture', () => {
    const { window, messages } = fixture()
    window.emit('resize')
    window.emit('resized')
    expect(messages).toEqual([])
  })

  it('clears interrupted gestures and allows subsequent drags', () => {
    for (const event of ['blur', 'hide', 'minimize']) {
      const { window, messages } = fixture()
      window.emit('will-resize')
      window.emit(event)
      expect(messages.at(-1)).toEqual([WINDOW_RESIZE_STATE, false])
      window.emit('will-resize')
      expect(messages.at(-1)).toEqual([WINDOW_RESIZE_STATE, true])
    }
  })

  it('leaves Linux on renderer debounce', () => {
    const { window, messages, query } = fixture('linux')
    window.emit('will-resize')
    expect(query()).toBe(false)
    expect(messages).toEqual([])
  })
})
