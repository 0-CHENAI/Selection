import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let openResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let saveResult: { canceled: boolean; filePath?: string } = { canceled: true }

mock.module('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: async () => openResult,
    showSaveDialog: async () => saveResult,
  },
}))

type Handler = (...args: any[]) => Promise<any>

describe('resource bundle file handlers', () => {
  let root: string
  let handlers: Map<string, Handler>

  beforeEach(async () => {
    root = join(tmpdir(), `resource-file-handler-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    handlers = new Map()
    openResult = { canceled: true, filePaths: [] }
    saveResult = { canceled: true }
    const server = {
      handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
    } as unknown as RpcServer
    const deps = {
      platform: { logger: console },
    } as unknown as HandlerDeps
    const { registerResourceFileHandlers } = await import('../resources')
    registerResourceFileHandlers(server, deps)
  })

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  it('does nothing when the open dialog is canceled', async () => {
    const result = await handlers.get(RPC_CHANNELS.resources.OPEN_BUNDLE_FILE)!({})
    expect(result).toEqual({ canceled: true })
  })

  it('opens a bundle from a non-workspace path containing Chinese characters', async () => {
    const dir = join(root, '导入位置')
    mkdirSync(dir)
    const path = join(dir, '资源.selection-resources.json')
    writeFileSync(path, JSON.stringify({ version: 1, exportedAt: 1, resources: {} }), 'utf8')
    openResult = { canceled: false, filePaths: [path] }

    const result = await handlers.get(RPC_CHANNELS.resources.OPEN_BUNDLE_FILE)!({})
    expect(result.canceled).toBe(false)
    expect(result.fileName).toBe('资源.selection-resources.json')
    expect(result.bundle.version).toBe(1)
  })

  it('rejects a selected file over 100 MB before parsing', async () => {
    const path = join(root, 'large.json')
    writeFileSync(path, '')
    truncateSync(path, 100 * 1024 * 1024 + 1)
    openResult = { canceled: false, filePaths: [path] }

    await expect(handlers.get(RPC_CHANNELS.resources.OPEN_BUNDLE_FILE)!({})).rejects.toThrow('100 MB')
  })

  it('saves atomically to the exact user-confirmed JSON path', async () => {
    const dir = join(root, '导出位置')
    mkdirSync(dir)
    const path = join(dir, '自定义名称.json')
    saveResult = { canceled: false, filePath: path }
    const bundle = { version: 1, exportedAt: 1, resources: {} }

    const result = await handlers.get(RPC_CHANNELS.resources.SAVE_BUNDLE_FILE)!({}, bundle, 'ignored')
    expect(result).toEqual({ canceled: false, filePath: path })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(bundle)
    expect(readdirSync(dir).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('does not write when the save dialog is canceled', async () => {
    const result = await handlers.get(RPC_CHANNELS.resources.SAVE_BUNDLE_FILE)!({}, { version: 1, exportedAt: 1, resources: {} }, 'bundle')
    expect(result).toEqual({ canceled: true })
    expect(readdirSync(root)).toHaveLength(0)
  })
})
