import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerFilesHandlers } from './files'

const handlers = new Map<string, HandlerFn>()
registerFilesHandlers({
  handle(channel, handler) { handlers.set(channel, handler) },
} as RpcServer, {} as HandlerDeps)

const statPath = handlers.get(RPC_CHANNELS.fs.STAT_PATH)
if (!statPath) throw new Error('STAT_PATH handler was not registered')
const context = { clientId: 'client-1' } as RequestContext

describe('fs:statPath', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-stat-path-'))
    mkdirSync(join(root, '.hidden', 'deep'), { recursive: true })
    writeFileSync(join(root, '.hidden', 'deep', 'SKILL.md'), 'skill')
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('finds a directory under hidden ancestors', async () => {
    const directory = join(root, '.hidden', 'deep')
    expect(await statPath(context, directory)).toEqual({ path: realpathSync(directory), type: 'directory' })
  })

  test('finds an exact file without a ranked search', async () => {
    const file = join(root, '.hidden', 'deep', 'SKILL.md')
    expect(await statPath(context, file)).toEqual({ path: realpathSync(file), type: 'file' })
  })

  test('returns null for a missing path', async () => {
    expect(await statPath(context, join(root, '.hidden', 'absent', 'SKILL.md'))).toBeNull()
  })
})
