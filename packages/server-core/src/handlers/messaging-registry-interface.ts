/** Abstract interface used by server-core to access the messaging gateway. */

export interface MessagingBindingInfo {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
  accessMode?: 'inherit' | 'allow-list' | 'open'
  allowedSenderIds?: string[]
}

export interface MessagingPlatformRuntimeInfo {
  platform: string
  configured: boolean
  connected: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
  identity?: string
  lastError?: string
  updatedAt: number
}

export interface MessagingPlatformOwnerInfo {
  userId: string
  displayName?: string
  username?: string
  addedAt: number
}

export type MessagingPendingRejectReason = 'not-owner' | 'not-on-binding-allowlist'

export interface MessagingPendingSenderInfo {
  platform: string
  userId: string
  displayName?: string
  username?: string
  lastAttemptAt: number
  attemptCount: number
  reason?: MessagingPendingRejectReason
  bindingId?: string
  sessionId?: string
  channelId?: string
  threadId?: number
}

export type MessagingPlatformAccessMode = 'open' | 'owner-only'
export type MessagingBindingAccessMode = 'inherit' | 'allow-list' | 'open'

export interface MessagingConfigInfo {
  enabled: boolean
  platforms: Record<
    string,
    | {
        enabled: boolean
        domain?: 'lark' | 'feishu'
        accessMode?: MessagingPlatformAccessMode
        owners?: MessagingPlatformOwnerInfo[]
      }
    | undefined
  >
  runtime: Record<string, MessagingPlatformRuntimeInfo | undefined>
}

export interface IMessagingGatewayRegistry {
  getBindings(workspaceId: string): MessagingBindingInfo[]
  getConfig(workspaceId: string): MessagingConfigInfo | null
  updateConfig(workspaceId: string, config: Partial<MessagingConfigInfo>): Promise<void>
  generatePairingCode(
    workspaceId: string,
    sessionId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string }
  unbindSession(workspaceId: string, sessionId: string, platform?: string): void
  unbindBinding(workspaceId: string, bindingId: string): boolean
  testLarkCredentials(creds: {
    appId: string
    appSecret: string
    domain: 'lark' | 'feishu'
  }): Promise<{ success: boolean; botName?: string; error?: string }>
  saveLarkCredentials(workspaceId: string, creds: {
    appId: string
    appSecret: string
    domain: 'lark' | 'feishu'
  }): Promise<void>
  disconnectPlatform(workspaceId: string, platform: string): Promise<void>
  forgetPlatform(workspaceId: string, platform: string): Promise<void>
  getPlatformOwners(workspaceId: string, platform: string): MessagingPlatformOwnerInfo[]
  setPlatformOwners(
    workspaceId: string,
    platform: string,
    owners: MessagingPlatformOwnerInfo[],
  ): MessagingPlatformOwnerInfo[]
  getPlatformAccessMode(workspaceId: string, platform: string): MessagingPlatformAccessMode
  setPlatformAccessMode(
    workspaceId: string,
    platform: string,
    mode: MessagingPlatformAccessMode,
  ): void
  getPendingSenders(workspaceId: string, platform?: string): MessagingPendingSenderInfo[]
  dismissPendingSender(workspaceId: string, platform: string, userId: string): boolean
  allowPendingSender(
    workspaceId: string,
    platform: string,
    userId: string,
    entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string },
  ): { owners: MessagingPlatformOwnerInfo[]; bindingId?: string }
  setBindingAccess(
    workspaceId: string,
    bindingId: string,
    access: { mode: MessagingBindingAccessMode; allowedSenderIds?: string[] },
  ): void
}
