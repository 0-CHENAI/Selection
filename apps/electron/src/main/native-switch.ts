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
  update(id: number, props: Partial<AddonProps>): boolean
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

interface SwitchOwner {
  document: number
  geometryRevision: number
  switches: Map<number, { nativeId: number; visible: boolean }>
}

const owners = new Map<Electron.WebContents, SwitchOwner>()
let nextNativeId = 1
let nextDocument = 1

function destroySwitches(owner: SwitchOwner, native: NativeSwitchAddon): void {
  for (const { nativeId } of owner.switches.values()) native.destroy(nativeId)
  owner.switches.clear()
}

function hideSwitches(owner: SwitchOwner, native: NativeSwitchAddon): void {
  owner.geometryRevision++
  for (const [id, entry] of owner.switches) {
    if (!entry.visible) continue
    let hidden = false
    try {
      hidden = native.update(entry.nativeId, { visible: false })
    } catch {
      // Remove views whose addon update has failed.
    }
    if (!hidden) {
      native.destroy(entry.nativeId)
      owner.switches.delete(id)
    }
    entry.visible = false
  }
}

function notifyGeometryChange(contents: Electron.WebContents, owner: SwitchOwner): void {
  if (!contents.isDestroyed()) contents.send('native-switch:geometry', owner.document, owner.geometryRevision)
}

function switchesFor(wc: Electron.WebContents, native: NativeSwitchAddon): SwitchOwner {
  const existing = owners.get(wc)
  if (existing) return existing
  const owner: SwitchOwner = { document: 0, geometryRevision: 0, switches: new Map() }
  owners.set(wc, owner)
  const cleanup = () => {
    owner.document = 0
    destroySwitches(owner, native)
  }
  wc.once('destroyed', () => {
    cleanup()
    owners.delete(wc)
  })
  wc.on('render-process-gone', cleanup)
  let previousDocument = 0
  wc.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (!isMainFrame || isSameDocument) return
    // A navigation may be cancelled by will-navigate. Keep the document's
    // handles until commit so the same renderer can restore them on cancellation.
    previousDocument = owner.document
    hideSwitches(owner, native)
    notifyGeometryChange(wc, owner)
  })
  wc.on('did-navigate', () => {
    if (owner.document === previousDocument) cleanup()
  })
  wc.on('zoom-changed', () => changeZoomWithNativeSwitchesHidden(wc))
  return owner
}

function getOwner(event: Electron.IpcMainInvokeEvent, document: number): SwitchOwner | undefined {
  if (!document || event.senderFrame !== event.sender.mainFrame) return
  const owner = owners.get(event.sender)
  if (owner?.document === document) return owner
}

// Chromium may share zoom settings across windows in the same session.
export function changeZoomWithNativeSwitchesHidden(wc: Electron.WebContents, changeZoom?: () => void): void {
  const affected = new Map<Electron.WebContents, SwitchOwner>()
  const native = addon
  if (native) {
    for (const [contents, owner] of owners) {
      if (!owner.document || contents.session !== wc.session) continue
      hideSwitches(owner, native)
      affected.set(contents, owner)
    }
  }
  changeZoom?.()
  for (const [contents, owner] of affected) notifyGeometryChange(contents, owner)
}

function addonProps(props: NativeSwitchProps): AddonProps | undefined {
  if (!props || ![props.x, props.y, props.width, props.height].every(Number.isFinite) ||
      props.width < 0 || props.height < 0 ||
      typeof props.on !== 'boolean' || typeof props.enabled !== 'boolean' || typeof props.visible !== 'boolean' ||
      (props.appearance !== 'light' && props.appearance !== 'dark')) return
  return {
    ...props,
    // Keep AppKit's accent desaturated even in OFF and during transitions.
    monochrome: props.on ? (props.appearance === 'dark' ? 3 : 2) : 1,
  }
}

export function registerNativeSwitchHandlers(): void {
  if (process.platform !== 'darwin') return

  ipcMain.on('native-switch:available-sync', (event) => {
    const native = loadAddon()
    if (!native || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      event.returnValue = 0
      return
    }
    const owner = switchesFor(event.sender, native)
    destroySwitches(owner, native)
    owner.geometryRevision = 0
    owner.document = nextDocument++
    event.returnValue = owner.document
  })

  ipcMain.handle('native-switch:create', (event, document: number, revision: number, id: number, props: NativeSwitchProps) => {
    const native = loadAddon()
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    const owner = getOwner(event, document)
    const values = addonProps(props)
    if (!native || !win || !owner || !values || !Number.isSafeInteger(id) || owner.switches.has(id)) return false
    if (owner.geometryRevision !== revision || sender.isLoadingMainFrame() || sender.getZoomFactor() !== 1) return null
    const nativeId = nextNativeId++
    const entry = { nativeId, visible: values.visible }
    const ok = native.create(nativeId, win.getNativeWindowHandle(), values, () => {
      if (!sender.isDestroyed() && owner.switches.get(id) === entry && entry.visible && sender.getZoomFactor() === 1) {
        sender.send(`native-switch:click:${id}`)
      }
    })
    if (ok) owner.switches.set(id, entry)
    return ok
  })

  ipcMain.handle('native-switch:update', (event, document: number, revision: number, id: number, props: NativeSwitchProps) => {
    const native = loadAddon()
    const owner = getOwner(event, document)
    const entry = owner?.switches.get(id)
    const values = addonProps(props)
    if (!native || !owner || !entry || !values) return false
    if (owner.geometryRevision !== revision) return null
    if (values.visible && (event.sender.isLoadingMainFrame() || event.sender.getZoomFactor() !== 1)) return null
    const ok = native.update(entry.nativeId, values)
    if (ok) entry.visible = values.visible
    return ok
  })

  ipcMain.handle('native-switch:destroy', (event, document: number, id: number) => {
    const owner = getOwner(event, document)
    const entry = owner?.switches.get(id)
    if (!owner || !entry) return
    loadAddon()?.destroy(entry.nativeId)
    owner.switches.delete(id)
  })

  ipcMain.handle('native-switch:destroy-all', (event, document: number) => {
    const owner = getOwner(event, document)
    const native = loadAddon()
    if (owner && native) destroySwitches(owner, native)
  })
}
