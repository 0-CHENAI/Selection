import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS, type SessionFile } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

const id = '11111111-1111-4111-8111-111111111111'
const root = mkdtempSync(join(tmpdir(), 'selection-session-files-'))
const sessionDir = join(root, 'session')
const attachments = join(sessionDir, 'attachments')
mkdirSync(attachments, { recursive: true })
writeFileSync(join(attachments, `${id}_pasted-image-1.png`), 'small')
writeFileSync(join(attachments, `${id}_pasted-image-1.original.png`), 'full')
writeFileSync(join(attachments, `${id}_thumb.png`), 'thumb')
writeFileSync(join(sessionDir, 'notes.md'), 'notes')

const handlers = new Map<string, HandlerFn>()
registerSessionsHandlers({
  handle(channel, handler) { handlers.set(channel, handler) },
} as RpcServer, {
  sessionManager: { getSessionPath: () => sessionDir },
  platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
} as unknown as HandlerDeps)

afterAll(() => rmSync(root, { recursive: true, force: true }))

function names(entries: SessionFile[]): string[] {
  return entries.flatMap(entry => entry.children ? [entry.name, ...names(entry.children)] : [entry.name])
}

describe('session file listing', () => {
  test('does not show the full-resolution sibling as a second attachment', async () => {
    const list = handlers.get(RPC_CHANNELS.sessions.GET_FILES)!
    const files = await list({} as never, 'session') as SessionFile[]
    const listed = names(files)
    expect(listed).toContain(`${id}_pasted-image-1.png`)
    expect(listed).toContain(`${id}_thumb.png`)
    expect(listed).toContain('notes.md')
    expect(listed).not.toContain(`${id}_pasted-image-1.original.png`)
  })
})
