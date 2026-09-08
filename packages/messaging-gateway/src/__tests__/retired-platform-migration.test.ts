import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import { BindingStore } from '../binding-store'
import { ConfigStore } from '../config-store'
import { cleanupRetiredMessagingData } from '../retired-platform-migration'
import type { MessagingLogger } from '../types'

let dir: string

const logger: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'retired-messaging-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('retired messaging platform migration', () => {
  it('loads and rewrites old config with only Lark preserved', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      enabled: true,
      platforms: {
        telegram: { enabled: true },
        whatsapp: { enabled: true },
        lark: { enabled: true, domain: 'feishu' },
      },
    }))

    const store = new ConfigStore(dir)

    expect(store.get().platforms).toEqual({ lark: { enabled: true, domain: 'feishu' } })
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).platforms).toEqual({
      lark: { enabled: true, domain: 'feishu' },
    })
  })

  it('does not overwrite a malformed config while falling back safely', () => {
    const malformed = '{"enabled": true, broken'
    writeFileSync(join(dir, 'config.json'), malformed)

    const store = new ConfigStore(dir)

    expect(store.get()).toEqual({ enabled: false, platforms: {} })
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(malformed)
  })

  it('returns a defensive copy of nested Lark owners', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      enabled: true,
      platforms: {
        lark: {
          enabled: true,
          owners: [{ userId: 'owner-1', displayName: 'Original', addedAt: 1 }],
        },
      },
    }))
    const store = new ConfigStore(dir)
    const snapshot = store.get()

    snapshot.platforms.lark!.owners![0]!.displayName = 'Mutated'
    snapshot.platforms.lark!.owners!.push({ userId: 'owner-2', addedAt: 2 })

    expect(store.get().platforms.lark?.owners).toEqual([
      { userId: 'owner-1', displayName: 'Original', addedAt: 1 },
    ])
  })

  it('drops old bindings while preserving Lark bindings', () => {
    const binding = (id: string, platform: string) => ({
      id,
      workspaceId: 'ws-1',
      sessionId: `session-${id}`,
      platform,
      channelId: `channel-${id}`,
      enabled: true,
      createdAt: 1,
      config: {},
    })
    writeFileSync(join(dir, 'bindings.json'), JSON.stringify([
      binding('t', 'telegram'),
      binding('w', 'whatsapp'),
      binding('l', 'lark'),
    ]))

    const store = new BindingStore(dir)

    expect(store.getAll().map((entry) => entry.id)).toEqual(['l'])
    expect(JSON.parse(readFileSync(join(dir, 'bindings.json'), 'utf8')).map((entry: { id: string }) => entry.id)).toEqual(['l'])
  })

  it('removes only retired credentials and local auth data', async () => {
    const removedCredentials: string[] = []
    const credentials = {
      delete: async (id: { name?: string }) => {
        removedCredentials.push(id.name ?? '')
        return true
      },
    } as unknown as CredentialManager
    mkdirSync(join(dir, 'whatsapp-auth'), { recursive: true })
    writeFileSync(join(dir, 'whatsapp-auth', 'state.json'), '{}')
    writeFileSync(join(dir, 'topics.json'), '{}')
    writeFileSync(join(dir, 'lark-state.json'), '{}')

    await cleanupRetiredMessagingData(dir, 'ws-1', credentials, logger)

    expect(removedCredentials).toEqual(['telegram', 'whatsapp'])
    expect(existsSync(join(dir, 'whatsapp-auth'))).toBe(false)
    expect(existsSync(join(dir, 'topics.json'))).toBe(false)
    expect(existsSync(join(dir, 'lark-state.json'))).toBe(true)
  })
})
