/**
 * native-switch — embeds real macOS NSSwitch controls into Electron windows.
 *
 * The renderer measures DOM placeholder rects and syncs them here over direct
 * ipcRenderer channels (never the WS RPC transport): the native control must
 * live in the window of the machine that displays it, which in thin-client
 * mode is not the machine the workspace server runs on.
 *
 * The addon binary is prebuilt (universal2, N-API ABI-stable) and shipped at
 * resources/native/switch.node. Source and rebuild instructions live in
 * apps/electron/native/switch/.
 *
 * Non-macOS or a missing/broken binary simply means "unavailable" and the
 * renderer falls back to the web component.
 */

import { BrowserWindow, ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { NativeSwitchProps } from '../shared/types'

type AddonProps = NativeSwitchProps & { monochrome: number }
interface NativeSwitchAddon {
  create(id: number, windowHandle: Buffer, props: AddonProps, onChange: (on: boolean) => void): boolean
  update(id: number, props: AddonProps): boolean
  destroy(id: number): void
}

let addon: NativeSwitchAddon | null | undefined

function resolveAddonPath(): string {
  const resourcesBase = app.isPackaged
    ? join(process.resourcesPath, 'app')
    : join(__dirname, '..')
  return join(resourcesBase, 'resources', 'native', 'switch.node')
}

function loadAddon(): NativeSwitchAddon | null {
  if (addon !== undefined) return addon
  addon = null
  if (process.platform !== 'darwin') return addon
  try {
    const binaryPath = resolveAddonPath()
    if (!existsSync(binaryPath)) {
      console.warn('[native-switch] binary missing at', binaryPath)
      return addon
    }
    addon = require(binaryPath) as NativeSwitchAddon
  } catch (error) {
    console.warn('[native-switch] failed to load addon:', error)
    addon = null
  }
  return addon
}

const owners = new WeakMap<Electron.WebContents, Map<number, number>>()
let nextNativeId = 1

function switchesFor(wc: Electron.WebContents, native: NativeSwitchAddon): Map<number, number> {
  const existing = owners.get(wc)
  if (existing) return existing
  const switches = new Map<number, number>()
  owners.set(wc, switches)
  const cleanup = () => {
    for (const id of switches.values()) {
      native.destroy(id)
    }
    switches.clear()
  }
  wc.once('destroyed', cleanup)
  wc.on('render-process-gone', cleanup)
  wc.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) cleanup()
  })
  return switches
}

function scaleProps(wc: Electron.WebContents, props: NativeSwitchProps): AddonProps | undefined {
  if (!props || ![props.x, props.y, props.width, props.height].every(Number.isFinite) ||
      props.width < 0 || props.height < 0 ||
      typeof props.on !== 'boolean' || typeof props.enabled !== 'boolean' || typeof props.visible !== 'boolean' ||
      (props.appearance !== 'light' && props.appearance !== 'dark')) return
  const zoom = wc.getZoomFactor()
  return {
    ...props,
    x: props.x * zoom,
    y: props.y * zoom,
    width: props.width * zoom,
    height: props.height * zoom,
    // Keep AppKit's accent desaturated even in OFF and during transitions.
    monochrome: props.on ? (props.appearance === 'dark' ? 3 : 2) : 1,
  }
}

export function registerNativeSwitchHandlers(): void {
  if (process.platform !== 'darwin') return

  ipcMain.on('native-switch:available-sync', (event) => {
    event.returnValue = event.senderFrame === event.sender.mainFrame && loadAddon() !== null
  })

  ipcMain.handle('native-switch:create', (event, id: number, props: NativeSwitchProps) => {
    const native = loadAddon()
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    if (!native || !win || event.senderFrame !== sender.mainFrame || !Number.isSafeInteger(id)) return false
    const scaled = scaleProps(sender, props)
    if (!scaled) return false
    const switches = switchesFor(sender, native)
    if (switches.has(id)) return false
    const nativeId = nextNativeId++
    const ok = native.create(nativeId, win.getNativeWindowHandle(), scaled, (on) => {
      if (!sender.isDestroyed()) sender.send(`native-switch:change:${id}`, on)
    })
    if (ok) switches.set(id, nativeId)
    return ok
  })

  ipcMain.handle('native-switch:update', ({ sender, senderFrame }, id: number, props: NativeSwitchProps) => {
    const native = loadAddon()
    const nativeId = owners.get(sender)?.get(id)
    if (!native || nativeId === undefined || senderFrame !== sender.mainFrame) return false
    const scaled = scaleProps(sender, props)
    return scaled ? native.update(nativeId, scaled) : false
  })

  ipcMain.handle('native-switch:destroy', ({ sender, senderFrame }, id: number) => {
    if (senderFrame !== sender.mainFrame) return
    const switches = owners.get(sender)
    const nativeId = switches?.get(id)
    if (nativeId === undefined) return
    loadAddon()?.destroy(nativeId)
    switches?.delete(id)
  })
}
