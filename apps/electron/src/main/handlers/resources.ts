import { randomUUID } from 'crypto'
import { basename, dirname, extname, join } from 'path'
import { readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ResourceBundle } from '@craft-agent/shared/resources'
import { validateResourceBundle } from '@craft-agent/shared/resources'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

const RESOURCE_BUNDLE_SUFFIX = '.selection-resources.json'
const MAX_RESOURCE_BUNDLE_BYTES = 100 * 1024 * 1024

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.resources.OPEN_BUNDLE_FILE,
  RPC_CHANNELS.resources.SAVE_BUNDLE_FILE,
] as const

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function normalizeSuggestedName(value: string): string {
  const safeName = basename(value || 'selection-resources')
  if (safeName.toLowerCase().endsWith(RESOURCE_BUNDLE_SUFFIX)) return safeName
  const withoutJson = extname(safeName).toLowerCase() === '.json'
    ? safeName.slice(0, -'.json'.length)
    : safeName
  return `${withoutJson}${RESOURCE_BUNDLE_SUFFIX}`
}

function normalizeBundlePath(value: string): string {
  if (value.toLowerCase().endsWith(RESOURCE_BUNDLE_SUFFIX)) return value
  // A user-entered .json name is valid and was the exact path confirmed by
  // Electron's overwrite prompt. Only names without a JSON extension need it.
  return extname(value).toLowerCase() === '.json' ? value : `${value}${RESOURCE_BUNDLE_SUFFIX}`
}

export function registerResourceFileHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.resources.OPEN_BUNDLE_FILE, async () => {
    const window = focusedWindow()
    const options: OpenDialogOptions = {
      title: 'Import resources',
      properties: ['openFile'],
      filters: [
        { name: 'Selection resource bundles', extensions: ['json'] },
        { name: 'JSON files', extensions: ['json'] },
      ],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }

    const filePath = result.filePaths[0]
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('The selected resource bundle is not a file')
    if (fileStat.size > MAX_RESOURCE_BUNDLE_BYTES) {
      throw new Error('Resource bundle exceeds the 100 MB limit')
    }

    let bundle: ResourceBundle
    try {
      bundle = JSON.parse(await readFile(filePath, 'utf8')) as ResourceBundle
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not parse resource bundle: ${message}`)
    }

    return { canceled: false, fileName: basename(filePath), bundle }
  })

  server.handle(
    RPC_CHANNELS.resources.SAVE_BUNDLE_FILE,
    async (_ctx, bundle: ResourceBundle, suggestedName: string) => {
      const validation = validateResourceBundle(bundle)
      if (!validation.valid) throw new Error(`Refusing to save invalid resource bundle: ${validation.errors.join('; ')}`)
      const window = focusedWindow()
      const options: SaveDialogOptions = {
        title: 'Export resources',
        defaultPath: normalizeSuggestedName(suggestedName),
        filters: [
          { name: 'Selection resource bundle', extensions: ['json'] },
          { name: 'JSON file', extensions: ['json'] },
        ],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { canceled: true }

      const filePath = normalizeBundlePath(result.filePath)
      const payload = `${JSON.stringify(bundle, null, 2)}\n`
      if (Buffer.byteLength(payload) > MAX_RESOURCE_BUNDLE_BYTES) {
        throw new Error('Resource bundle exceeds the 100 MB limit')
      }

      const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
      try {
        await writeFile(tempPath, payload, { encoding: 'utf8', flag: 'wx' })
        await rename(tempPath, filePath)
      } catch (error) {
        await unlink(tempPath).catch(() => undefined)
        deps.platform.logger.error('Failed to save resource bundle:', error)
        throw error
      }

      return { canceled: false, filePath }
    },
  )
}
