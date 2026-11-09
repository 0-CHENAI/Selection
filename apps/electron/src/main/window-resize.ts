import type { BrowserWindow, IpcMainEvent } from 'electron'
import { GET_WINDOW_RESIZE_STATE, WINDOW_RESIZE_STATE } from '../shared/window-resize'

/** Track the native gesture, including pauses while the window edge is held. */
export function trackWindowResize(window: BrowserWindow, platform = process.platform): void {
  // Electron exposes will-resize/resized only on macOS and Windows.
  if (platform !== 'darwin' && platform !== 'win32') return

  const contents = window.webContents
  const ipc = contents.ipc
  let resizing = false
  const publish = () => {
    if (!contents.isDestroyed() && contents.mainFrame) {
      contents.send(WINDOW_RESIZE_STATE, resizing)
    }
  }
  const setResizing = (value: boolean) => {
    if (resizing === value) return
    resizing = value
    publish()
  }
  const begin = () => setResizing(true)
  const end = () => setResizing(false)
  const getState = (event: IpcMainEvent) => {
    if (event.senderFrame === contents.mainFrame) publish()
  }
  window.on('will-resize', begin)
  window.on('resized', end)
  // Clear interrupted gestures when the window is deactivated or hidden.
  window.on('blur', end)
  window.on('hide', end)
  window.on('minimize', end)
  ipc.on(GET_WINDOW_RESIZE_STATE, getState)
  window.once('closed', () => {
    window.removeListener('will-resize', begin)
    window.removeListener('resized', end)
    window.removeListener('blur', end)
    window.removeListener('hide', end)
    window.removeListener('minimize', end)
    ipc.removeListener(GET_WINDOW_RESIZE_STATE, getState)
  })
}
