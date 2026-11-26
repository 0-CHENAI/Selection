import type { SessionCompletionEvent } from '@craft-agent/server-core/sessions'
import { WeixinLogin } from './adapters/weixin/login'
import { WeixinAdapter } from './adapters/weixin'
import type { WeixinAccount } from './adapters/weixin/api'
import { isMessagingPlatform as isKnownPlatform } from './types'
import { RPC_CHANNELS, type WeixinLoginRequest, type PushTarget } from '@craft-agent/shared/protocol'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type {
  ISessionManager,
  IMessagingGatewayRegistry,
  MessagingBindingInfo,
  MessagingConfigInfo,
} from '@craft-agent/server-core/handlers'
import { MessagingGateway } from './gateway'
import { ConfigStore } from './config-store'
import { PairingCodeManager } from './pairing'
import { LarkAdapter, parseLarkCredentials, type LarkCredentials } from './adapters/lark/index'
import { cleanupRetiredMessagingData } from './retired-platform-migration'
import type { EventSinkFn } from './event-fanout'
import type { SessionEvent } from './renderer'
import type {
  BindingAccessMode,
  ChannelBinding,
  MessagingConfig,
  MessagingLogger,
  MessagingPlatformRuntimeInfo,
  PendingSender,
  PlatformAccessMode,
  PlatformOwner,
  PlatformType,
} from './types'

const consoleLogger: MessagingLogger = {
  info: (message, meta) => console.log('[MessagingRegistry]', message, meta ?? ''),
  warn: (message, meta) => console.warn('[MessagingRegistry]', message, meta ?? ''),
  error: (message, meta) => console.error('[MessagingRegistry]', message, meta ?? ''),
  child(context) {
    return {
      info: (message, meta) => console.log('[MessagingRegistry]', context, message, meta ?? ''),
      warn: (message, meta) => console.warn('[MessagingRegistry]', context, message, meta ?? ''),
      error: (message, meta) => console.error('[MessagingRegistry]', context, message, meta ?? ''),
      child: (next) => consoleLogger.child({ ...context, ...next }),
    }
  },
}

export interface MessagingGatewayRegistryOptions {
  sessionManager: ISessionManager
  credentialManager: CredentialManager
  getMessagingDir: (workspaceId: string) => string
  getLegacyMessagingDir?: (workspaceId: string) => string | undefined
  publishEvent?: (channel: string, target: PushTarget, ...args: unknown[]) => void
  logger?: MessagingLogger
}

interface WorkspaceState {
  login: WeixinLogin
  weixinAccount?: string
  weixinQueue: Promise<void>
  gateway: MessagingGateway
  configStore: ConfigStore
  botUsernames: Partial<Record<PlatformType, string>>
  runtime: Record<PlatformType, MessagingPlatformRuntimeInfo>
}

export class MessagingGatewayRegistry implements IMessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly pairing = new PairingCodeManager()
  private readonly log: MessagingLogger

  constructor(private readonly opts: MessagingGatewayRegistryOptions) {
    this.log = (opts.logger ?? consoleLogger).child({ component: 'registry' })
  }

  async initializeWorkspace(workspaceId: string): Promise<void> {
    await cleanupRetiredMessagingData(
      this.opts.getMessagingDir(workspaceId),
      workspaceId,
      this.opts.credentialManager,
      this.log,
    )
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const config = state.configStore.get()
    if (!config.enabled) return
    await state.gateway.start()
    if (isPlatformConfigured(config, 'weixin')) {
      await this.queueWeixin(state, async () => {
        try {
          const saved = await this.opts.credentialManager.get({ type: 'messaging_bearer', workspaceId, name: 'weixin' })
          if (!saved?.value) throw new Error('WeChat credentials missing')
          await this.connectWeixin(workspaceId, state, JSON.parse(saved.value), false)
        } catch (error) {
          this.setPlatformRuntime(workspaceId, state, 'weixin', { configured: true, connected: false, state: 'reconnect_required', lastError: String(error) })
        }
      })
    }
    if (isPlatformConfigured(config, 'lark')) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'connecting',
        lastError: undefined,
      })
      void this.tryConnectLark(workspaceId, state).catch((error) => {
        this.log.error('background Lark connect failed', {
          event: 'lark_connect_failed',
          workspaceId,
          error,
        })
      })
    }
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    state.login.cancel()
    await state.weixinQueue
    await state.gateway.stop()
    this.pairing.clearWorkspace(workspaceId)
    this.workspaces.delete(workspaceId)
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.workspaces.keys()).map(id => this.removeWorkspace(id)))
    this.workspaces.clear()
  }

  get size(): number {
    return this.workspaces.size
  }

  getConfig(workspaceId: string): MessagingConfigInfo {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const config = state.configStore.get()
    return {
      enabled: config.enabled,
      platforms: config.platforms,
      runtime: { lark: cloneRuntime(state.runtime.lark), weixin: { ...state.runtime.weixin, notifyOnCompletion: config.platforms.weixin?.notifyOnCompletion === true } },
    }
  }

  async updateConfig(workspaceId: string, partial: Partial<MessagingConfigInfo>): Promise<void> {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update({ enabled: partial.enabled, platforms: partial.platforms })
    const next = state.configStore.get()
    if (partial.platforms?.weixin?.notifyOnCompletion !== undefined) {
      this.setPlatformRuntime(workspaceId, state, 'weixin', {})
    }
    for (const platform of ['lark', 'weixin'] as const) {
      if (partial.enabled === undefined && !partial.platforms?.[platform]) continue
      if (isPlatformConfigured(next, platform)) continue
      if (platform === 'weixin') state.login.cancel()
      await state.gateway.unregisterAdapter(platform)
      this.setPlatformRuntime(workspaceId, state, platform, {
        configured: false, connected: false, state: 'disconnected', identity: undefined, lastError: undefined,
      })
    }
  }

  getBindings(workspaceId: string): MessagingBindingInfo[] {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return state.gateway.getBindingStore().getAll().map(toBindingInfo)
  }

  unbindSession(workspaceId: string, sessionId: string, platform?: string): void {
    const state = this.workspaces.get(workspaceId)
    if (!state || (platform !== undefined && !isKnownPlatform(platform))) return
    const removed = state.gateway.getBindingStore().unbindSession(sessionId, platform)
    if (removed > 0) this.emitBindingChanged(workspaceId)
  }

  unbindBinding(workspaceId: string, bindingId: string): boolean {
    const state = this.workspaces.get(workspaceId)
    if (!state) return false
    const removed = state.gateway.getBindingStore().unbindById(bindingId)
    if (removed) this.emitBindingChanged(workspaceId)
    return removed
  }

  generatePairingCode(
    workspaceId: string,
    sessionId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string } {
    if (!isKnownPlatform(platform)) throw new Error(`Unknown messaging platform: ${platform}`)
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    if (!state.gateway.hasConnectedAdapter(platform)) throw new Error(platform === 'lark' ? 'Lark is not connected' : 'WeChat is not connected')
    const generated = this.pairing.generate(workspaceId, sessionId, platform)
    return { ...generated, botUsername: state.botUsernames[platform] }
  }

  async testLarkCredentials(
    creds: LarkCredentials,
  ): Promise<{ success: boolean; botName?: string; error?: string }> {
    if (!creds.appId || !creds.appSecret) {
      return { success: false, error: 'App ID or App Secret is empty' }
    }
    try {
      const url = creds.domain === 'feishu'
        ? 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
        : 'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal'
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
      })
      const body = await response.json() as { code?: number; msg?: string; tenant_access_token?: string }
      return body.code === 0 && body.tenant_access_token
        ? { success: true }
        : { success: false, error: body.msg ?? 'Invalid credentials' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  async saveLarkCredentials(workspaceId: string, creds: LarkCredentials): Promise<void> {
    if (creds.domain !== 'lark' && creds.domain !== 'feishu') {
      throw new Error('Domain must be "lark" or "feishu"')
    }
    const result = await this.testLarkCredentials(creds)
    if (!result.success) throw new Error(result.error ?? 'Invalid Lark credentials')
    await this.opts.credentialManager.set(
      { type: 'messaging_bearer', workspaceId, name: 'lark' },
      { value: JSON.stringify(creds) },
    )
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const previous = state.configStore.get().platforms.lark
    state.configStore.update({
      enabled: true,
      platforms: { lark: { ...(previous ?? { accessMode: 'owner-only' }), enabled: true, domain: creds.domain } },
    })
    this.setPlatformRuntime(workspaceId, state, 'lark', {
      configured: true,
      connected: false,
      state: 'connecting',
      lastError: undefined,
    })
    await this.tryConnectLark(workspaceId, state)
    await state.gateway.start()
  }

  private queueWeixin<T>(state: WorkspaceState, action: () => Promise<T>): Promise<T> {
    const result = state.weixinQueue.then(action)
    state.weixinQueue = result.then(() => {}, () => {})
    return result
  }

  async weixinLogin(workspaceId: string, request: WeixinLoginRequest) {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return state.login.handle(request, account =>
      this.queueWeixin(state, () => this.connectWeixin(workspaceId, state, account, true)), async () => {
      const saved = await this.opts.credentialManager.get({ type: 'messaging_bearer', workspaceId, name: 'weixin' })
      const token = saved?.value && (JSON.parse(saved.value) as WeixinAccount).token
      return token ? [token] : []
    })
  }

  private async connectWeixin(workspaceId: string, state: WorkspaceState, account: WeixinAccount, save: boolean) {
    if (!account.botId || !account.token) throw new Error('Incomplete WeChat account')
    for (const other of this.workspaces.values()) {
      if (other !== state && other.weixinAccount === account.botId) throw new Error('WeChat is connected to another workspace')
    }
    const previous = state.weixinAccount
    state.weixinAccount = account.botId
    const adapter = new WeixinAdapter(account, this.opts.getMessagingDir(workspaceId), status => {
      if (state.gateway.getAdapter('weixin') === adapter) this.setPlatformRuntime(workspaceId, state, 'weixin',
        { connected: status === 'connected', state: status })
    }, () => this.getPlatformOwners(workspaceId, 'weixin')[0]?.userId)
    try {
      await adapter.initialize()
      if (save) {
        await this.opts.credentialManager.set({ type: 'messaging_bearer', workspaceId, name: 'weixin' },
          { value: JSON.stringify(account) })
        state.configStore.update({ enabled: true, platforms: { weixin: {
          enabled: true, accessMode: 'owner-only',
          ...(previous !== account.botId || (account.userId && this.getPlatformOwners(workspaceId, 'weixin')[0]?.userId !== account.userId)
            ? { notifyOnCompletion: false } : {}),
          owners: account.userId ? [{ userId: account.userId, addedAt: Date.now() }]
            : previous === account.botId ? this.getPlatformOwners(workspaceId, 'weixin') : [],
        } } })
      }
      const replacingSameAccount = previous === account.botId && state.gateway.getAdapter('weixin')
      await state.gateway.unregisterAdapter('weixin')
      // The retiring poller may have saved its cursor or a confirmed quote
      // while the new credentials were being saved.
      if (replacingSameAccount) await adapter.initialize()
      state.gateway.registerAdapter(adapter)
      await state.gateway.start()
      this.setPlatformRuntime(workspaceId, state, 'weixin', { configured: true, connected: true, state: 'connected',
        identity: account.botId, lastError: undefined })
    } catch (error) {
      state.weixinAccount = previous
      throw error
    }
  }

  async disconnectPlatform(workspaceId: string, platform: string): Promise<void> {
    if (!isKnownPlatform(platform)) return
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    if (platform === 'weixin') {
      state.login.cancel()
      return this.queueWeixin(state, async () => {
        await this.disablePlatform(workspaceId, platform, state)
        state.weixinAccount = undefined
      })
    }
    await this.disablePlatform(workspaceId, platform, state)
  }

  private async disablePlatform(workspaceId: string, platform: PlatformType, state: WorkspaceState) {
    await this.opts.credentialManager.delete({ type: 'messaging_bearer', workspaceId, name: platform })
    await state.gateway.unregisterAdapter(platform)
    this.pairing.clearWorkspace(workspaceId, platform)
    const current = state.configStore.get()
    const other = platform === 'lark' ? 'weixin' : 'lark'
    state.configStore.update({
      enabled: Boolean(current.platforms[other]?.enabled),
      platforms: { [platform]: { enabled: false, ...(platform === 'weixin' ? { notifyOnCompletion: false } : {}) } },
    })
    this.setPlatformRuntime(workspaceId, state, platform, {
      configured: false,
      connected: false,
      state: 'disconnected',
      identity: undefined,
      lastError: undefined,
    })
  }

  async forgetPlatform(workspaceId: string, platform: string): Promise<void> {
    await this.disconnectPlatform(workspaceId, platform)
  }

  getPlatformOwners(workspaceId: string, platform: string): PlatformOwner[] {
    if (!isKnownPlatform(platform)) return []
    return (this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId))
      .configStore.get().platforms[platform]?.owners ?? []
  }

  setPlatformOwners(workspaceId: string, platform: string, owners: PlatformOwner[]): PlatformOwner[] {
    if (!isKnownPlatform(platform)) throw new Error('Unsupported messaging platform')
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    this.patchPlatformConfig(state, platform, { owners: dedupeOwners(owners) })
    this.emitBindingChanged(workspaceId)
    return state.configStore.get().platforms[platform]?.owners ?? []
  }

  getPlatformAccessMode(workspaceId: string, platform: string): PlatformAccessMode {
    if (!isKnownPlatform(platform)) return 'open'
    return (this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId))
      .configStore.get().platforms[platform]?.accessMode ?? 'open'
  }

  setPlatformAccessMode(workspaceId: string, platform: string, mode: PlatformAccessMode): void {
    if (!isKnownPlatform(platform)) throw new Error('Unsupported messaging platform')
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    this.patchPlatformConfig(state, platform, { accessMode: mode })
    if (mode === 'owner-only') {
      for (const binding of state.gateway.getBindingStore().getAll()) {
        if (binding.platform === platform && binding.config.accessMode === 'open') {
          state.gateway.getBindingStore().updateBindingConfig(binding.id, {
            accessMode: 'inherit',
            allowedSenderIds: [],
          })
        }
      }
    }
    this.emitBindingChanged(workspaceId)
  }

  getPendingSenders(workspaceId: string, platform?: string): PendingSender[] {
    if (platform !== undefined && !isKnownPlatform(platform)) return []
    const state = this.workspaces.get(workspaceId)
    return state ? state.gateway.getPendingStore().list(platform) : []
  }

  dismissPendingSender(workspaceId: string, platform: string, userId: string): boolean {
    if (!isKnownPlatform(platform)) return false
    const state = this.workspaces.get(workspaceId)
    return state ? state.gateway.getPendingStore().dismiss(platform, userId) : false
  }

  allowPendingSender(
    workspaceId: string,
    platform: string,
    userId: string,
    entryKey?: { reason?: PendingSender['reason']; bindingId?: string },
  ): { owners: PlatformOwner[]; bindingId?: string } {
    if (!isKnownPlatform(platform)) throw new Error('Unsupported messaging platform')
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const match = state.gateway.getPendingStore().list(platform).find((entry) =>
      entry.userId === userId
      && (entryKey?.reason === undefined || (entry.reason ?? 'not-owner') === entryKey.reason)
      && (entryKey?.bindingId === undefined || entry.bindingId === entryKey.bindingId))
    if (!match) throw new Error('Pending sender not found')
    if ((match.reason ?? 'not-owner') === 'not-on-binding-allowlist' && match.bindingId) {
      const binding = state.gateway.getBindingStore().getAll().find((entry) => entry.id === match.bindingId)
      if (!binding) {
        state.gateway.getPendingStore().dismiss(platform, userId, {
          reason: 'not-on-binding-allowlist',
          bindingId: match.bindingId,
        })
        throw new Error('Binding no longer exists')
      }
      state.gateway.getBindingStore().updateBindingConfig(binding.id, {
        accessMode: 'allow-list',
        allowedSenderIds: Array.from(new Set([...binding.config.allowedSenderIds, userId])),
      })
      state.gateway.getPendingStore().dismiss(platform, userId, {
        reason: 'not-on-binding-allowlist',
        bindingId: binding.id,
      })
      this.emitBindingChanged(workspaceId)
      return { owners: this.getPlatformOwners(workspaceId, platform), bindingId: binding.id }
    }
    const owners = this.getPlatformOwners(workspaceId, platform)
    const next = owners.some((owner) => owner.userId === userId) ? owners : [
      ...owners,
      {
        userId,
        ...(match.displayName ? { displayName: match.displayName } : {}),
        ...(match.username ? { username: match.username } : {}),
        addedAt: Date.now(),
      },
    ]
    this.setPlatformOwners(workspaceId, platform, next)
    state.gateway.getPendingStore().dismiss(platform, userId)
    return { owners: next }
  }

  setBindingAccess(
    workspaceId: string,
    bindingId: string,
    access: { mode: BindingAccessMode; allowedSenderIds?: string[] },
  ): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) throw new Error('Workspace not initialised')
    const updated = state.gateway.getBindingStore().updateBindingConfig(bindingId, {
      accessMode: access.mode,
      allowedSenderIds: access.mode === 'allow-list' ? [...(access.allowedSenderIds ?? [])] : [],
    })
    if (!updated) throw new Error('Binding not found')
    this.emitBindingChanged(workspaceId)
  }

  async onSessionComplete(event: SessionCompletionEvent) {
    await this.workspaces.get(event.workspaceId)?.gateway.onSessionComplete(event)
  }

  onSessionEvent: EventSinkFn = (channel: string, target: PushTarget, ...args: unknown[]) => {
    if (channel !== RPC_CHANNELS.sessions.EVENT) return
    const event = args[0] as SessionEvent | undefined
    if (!event?.sessionId) return
    const workspaceId = 'workspaceId' in target ? target.workspaceId : undefined
    if (workspaceId) this.workspaces.get(workspaceId)?.gateway.onSessionEvent(channel, target, ...args)
    else for (const state of this.workspaces.values()) state.gateway.onSessionEvent(channel, target, ...args)
  }

  private bootstrapWorkspace(workspaceId: string): WorkspaceState {
    const existing = this.workspaces.get(workspaceId)
    if (existing) return existing
    const storageDir = this.opts.getMessagingDir(workspaceId)
    const legacyStorageDir = this.opts.getLegacyMessagingDir?.(workspaceId)
    const logger = this.log.child({ workspaceId })
    const configStore = new ConfigStore(storageDir, legacyStorageDir, logger.child({ component: 'config-store' }))
    const gateway = new MessagingGateway({
      sessionManager: this.opts.sessionManager,
      workspaceId,
      storageDir,
      legacyStorageDir,
      logger,
      pairingConsumer: {
        canConsume: (platform, senderId) => this.pairing.canConsume(workspaceId, platform, senderId),
        consume: (platform, code) => {
          const entry = this.pairing.consume(workspaceId, platform, code)
          return entry ? { workspaceId: entry.workspaceId, sessionId: entry.sessionId } : null
        },
      },
      getWorkspaceConfig: () => configStore.get(),
      seedOwnerOnFirstPair: async (platform, candidate) => this.seedFirstOwner(workspaceId, platform, candidate),
      onBindingChanged: () => this.emitBindingChanged(workspaceId),
      onPendingChanged: () => this.emitPendingChanged(workspaceId),
    })
    const config = configStore.get()
    const state: WorkspaceState = {
      gateway,
      configStore,
      botUsernames: {},
      login: new WeixinLogin(),
      weixinQueue: Promise.resolve(),
      runtime: { lark: createRuntime('lark', isPlatformConfigured(config, 'lark')), weixin: createRuntime('weixin', isPlatformConfigured(config, 'weixin')) },
    }
    this.workspaces.set(workspaceId, state)
    return state
  }

  private async tryConnectLark(workspaceId: string, state: WorkspaceState): Promise<void> {
    const credential = await this.opts.credentialManager
      .get({ type: 'messaging_bearer', workspaceId, name: 'lark' })
      .catch(() => null)
    if (!credential?.value) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: 'Lark credentials are missing.',
      })
      return
    }
    const creds = parseLarkCredentials(credential.value)
    await state.gateway.unregisterAdapter('lark').catch(() => {})
    try {
      const adapter = new LarkAdapter()
      await adapter.initialize({
        token: credential.value,
        logger: this.log.child({ component: 'lark-adapter', workspaceId, platform: 'lark' }),
      })
      try {
        state.botUsernames.lark = (await adapter.getBotInfo())?.name
      } catch {}
      state.gateway.registerAdapter(adapter)
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: true,
        state: 'connected',
        identity: state.botUsernames.lark ?? creds.domain,
        lastError: undefined,
      })
    } catch (error) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async seedFirstOwner(workspaceId: string, platform: PlatformType, candidate: PlatformOwner): Promise<PlatformOwner[]> {
    const current = this.getPlatformOwners(workspaceId, platform)
    if (current.length > 0) return current
    return this.setPlatformOwners(workspaceId, platform, [candidate])
  }

  private patchPlatformConfig(
    state: WorkspaceState,
    platform: PlatformType,
    patch: Partial<NonNullable<MessagingConfig['platforms']['lark']>>,
  ): void {
    const config = state.configStore.get()
    state.configStore.update({
      platforms: { [platform]: { ...(config.platforms[platform] ?? { enabled: true }), ...patch } },
    })
  }

  private setPlatformRuntime(
    workspaceId: string,
    state: WorkspaceState,
    platform: PlatformType,
    patch: Partial<MessagingPlatformRuntimeInfo>,
  ): void {
    const next = { ...state.runtime[platform], ...patch, platform, updatedAt: Date.now() }
    state.runtime[platform] = next
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.PLATFORM_STATUS,
      { to: 'workspace', workspaceId },
      workspaceId,
      platform,
      platform === 'weixin' ? { ...next, notifyOnCompletion: state.configStore.get().platforms.weixin?.notifyOnCompletion === true } : cloneRuntime(next),
    )
  }

  private emitBindingChanged(workspaceId: string): void {
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.BINDING_CHANGED,
      { to: 'workspace', workspaceId },
      workspaceId,
    )
  }

  private emitPendingChanged(workspaceId: string): void {
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.PENDING_CHANGED,
      { to: 'workspace', workspaceId },
      workspaceId,
    )
  }
}

function toBindingInfo(binding: ChannelBinding): MessagingBindingInfo {
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    sessionId: binding.sessionId,
    platform: binding.platform,
    channelId: binding.channelId,
    ...(binding.threadId !== undefined ? { threadId: binding.threadId } : {}),
    channelName: binding.channelName,
    enabled: binding.enabled,
    createdAt: binding.createdAt,
    accessMode: binding.config.accessMode,
    allowedSenderIds: [...binding.config.allowedSenderIds],
  }
}

function isPlatformConfigured(config: MessagingConfig, platform: PlatformType): boolean {
  return Boolean(config.enabled && config.platforms[platform]?.enabled)
}

function dedupeOwners(owners: PlatformOwner[]): PlatformOwner[] {
  return Array.from(new Map(owners.filter((owner) => owner.userId).map((owner) => [owner.userId, { ...owner }])).values())
}

function createRuntime(platform: PlatformType, configured: boolean): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}

function cloneRuntime(runtime: MessagingPlatformRuntimeInfo): MessagingPlatformRuntimeInfo {
  return { ...runtime }
}
