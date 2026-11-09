import type { PushTarget } from '@craft-agent/shared/protocol'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from './registry'
import { createFanOutSink, type EventSinkFn } from './event-fanout'
import type { MessagingLogger } from './types'

export type PublishEventFn = (channel: string, target: PushTarget, ...args: unknown[]) => void

export interface MessagingBootstrapOptions {
  sessionManager: ISessionManager
  credentialManager: CredentialManager
  getMessagingDir: (workspaceId: string) => string
  getLegacyMessagingDir?: (workspaceId: string) => string | undefined
  logger?: MessagingLogger
}

export interface MessagingBootstrapHandle {
  readonly registry: MessagingGatewayRegistry
  setPublisher(push: PublishEventFn): void
  wrapSink(baseSink: EventSinkFn): EventSinkFn
  initializeWorkspaces(workspaceIds: string[]): Promise<void>
  dispose(): Promise<void>
}

export function createMessagingBootstrap(opts: MessagingBootstrapOptions): MessagingBootstrapHandle {
  let publisher: PublishEventFn | null = null
  const log = opts.logger?.child({ component: 'bootstrap' })
  const registry = new MessagingGatewayRegistry({
    sessionManager: opts.sessionManager,
    credentialManager: opts.credentialManager,
    getMessagingDir: opts.getMessagingDir,
    getLegacyMessagingDir: opts.getLegacyMessagingDir,
    logger: opts.logger,
    publishEvent: (channel, target, ...args) => publisher?.(channel, target, ...args),
  })

  log?.info('messaging bootstrap created', {
    event: 'messaging_bootstrap_created',
  })

  return {
    registry,
    setPublisher(push) {
      publisher = push
    },
    wrapSink(baseSink) {
      return createFanOutSink(baseSink, registry.onSessionEvent)
    },
    async initializeWorkspaces(workspaceIds) {
      for (const workspaceId of workspaceIds) {
        try {
          await registry.initializeWorkspace(workspaceId)
        } catch (error) {
          log?.error('failed to initialize workspace', {
            event: 'workspace_init_failed',
            workspaceId,
            error,
          })
        }
      }
    },
    async dispose() {
      await registry.stopAll().catch(() => {})
    },
  }
}
