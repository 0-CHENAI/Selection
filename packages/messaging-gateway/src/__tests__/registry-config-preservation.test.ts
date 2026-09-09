import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from '../registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-cfg-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeRegistry() {
  return new MessagingGatewayRegistry({
    sessionManager: {} as ISessionManager,
    credentialManager: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as unknown as CredentialManager,
    getMessagingDir: (workspaceId) => join(dir, 'workspaces', workspaceId, 'messaging'),
  })
}

describe('MessagingGatewayRegistry config preservation', () => {
  it('preserves owners when changing access mode', () => {
    const registry = makeRegistry()
    registry.setPlatformOwners('ws-test', 'lark', [
      { userId: 'owner-1', addedAt: Date.now() },
    ])

    registry.setPlatformAccessMode('ws-test', 'lark', 'owner-only')

    expect(registry.getPlatformOwners('ws-test', 'lark').map((owner) => owner.userId)).toEqual(['owner-1'])
    expect(registry.getPlatformAccessMode('ws-test', 'lark')).toBe('owner-only')
  })

  it('does not replace an existing owner when seeding after pairing', async () => {
    const registry = makeRegistry()
    registry.setPlatformOwners('ws-test', 'lark', [
      { userId: 'first', addedAt: Date.now() },
    ])
    const internal = registry as unknown as {
      seedFirstOwner: (workspaceId: string, platform: 'lark', owner: { userId: string; addedAt: number }) => Promise<Array<{ userId: string }>>
    }

    const seeded = await internal.seedFirstOwner('ws-test', 'lark', {
      userId: 'second',
      addedAt: Date.now(),
    })

    expect(seeded.map((owner) => owner.userId)).toEqual(['first'])
  })

  it('migrates open Lark bindings to inherited access when locking down', () => {
    const registry = makeRegistry()
    const internal = registry as unknown as {
      bootstrapWorkspace: (workspaceId: string) => {
        gateway: { getBindingStore: () => import('../binding-store').BindingStore }
      }
    }
    const store = internal.bootstrapWorkspace('ws-test').gateway.getBindingStore()
    const binding = store.bind('ws-test', 'session-a', 'lark', 'chat-a', undefined, {
      accessMode: 'open',
    })

    registry.setPlatformAccessMode('ws-test', 'lark', 'owner-only')

    const reloaded = store.getAll().find((entry) => entry.id === binding.id)
    expect(reloaded?.config.accessMode).toBe('inherit')
    expect(reloaded?.createdAt).toBe(binding.createdAt)
  })
})
