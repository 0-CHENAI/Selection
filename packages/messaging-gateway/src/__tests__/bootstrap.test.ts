import { describe, expect, it } from 'bun:test'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { createMessagingBootstrap } from '../bootstrap'
import type { MessagingLogger } from '../types'

describe('messaging bootstrap', () => {
  it('continues initializing workspaces after one workspace fails', async () => {
    const failures: Array<Record<string, unknown> | undefined> = []
    const logger: MessagingLogger = {
      info: () => {},
      warn: () => {},
      error: (_message, meta) => failures.push(meta),
      child: () => logger,
    }
    const handle = createMessagingBootstrap({
      sessionManager: {} as ISessionManager,
      credentialManager: {} as CredentialManager,
      getMessagingDir: (workspaceId) => workspaceId,
      logger,
    })
    const initialized: string[] = []
    handle.registry.initializeWorkspace = async (workspaceId) => {
      initialized.push(workspaceId)
      if (workspaceId === 'broken') throw new Error('boom')
    }

    await handle.initializeWorkspaces(['first', 'broken', 'last'])

    expect(initialized).toEqual(['first', 'broken', 'last'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      event: 'workspace_init_failed',
      workspaceId: 'broken',
    })
  })
})
