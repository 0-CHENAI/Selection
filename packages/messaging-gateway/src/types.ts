/** Core types for the Lark/Feishu messaging gateway. */

export type PlatformType = 'lark'

export interface MessagingLogContext {
  component?: string
  workspaceId?: string
  sessionId?: string
  platform?: string
  channelId?: string
  bindingId?: string
  event?: string
}

export type MessagingLogMeta = Record<string, unknown>

export interface MessagingLogger {
  info(message: string, meta?: MessagingLogMeta): void
  warn(message: string, meta?: MessagingLogMeta): void
  error(message: string, meta?: MessagingLogMeta): void
  child(context: MessagingLogContext): MessagingLogger
}

export type MessagingPlatformRuntimeState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnect_required'
  | 'error'

export interface MessagingPlatformRuntimeInfo {
  platform: PlatformType
  configured: boolean
  connected: boolean
  state: MessagingPlatformRuntimeState
  identity?: string
  lastError?: string
  updatedAt: number
}

export interface AdapterCapabilities {
  messageEditing: boolean
  inlineButtons: boolean
  maxButtons: number
  maxMessageLength: number
  markdown: 'lark-post'
  webhookSupport: boolean
}

export interface IncomingAttachment {
  type: 'photo' | 'document' | 'voice' | 'video' | 'audio'
  fileId: string
  fileName?: string
  mimeType?: string
  fileSize?: number
  localPath?: string
}

export interface IncomingMessage {
  platform: PlatformType
  channelId: string
  threadId?: number
  messageId: string
  senderId: string
  senderName?: string
  senderUsername?: string
  senderIsBot?: boolean
  text: string
  attachments?: IncomingAttachment[]
  replyToMessageId?: string
  timestamp: number
  raw: unknown
}

export interface SentMessage {
  platform: PlatformType
  channelId: string
  messageId: string
}

export interface InlineButton {
  id: string
  label: string
  data?: string
}

export interface ButtonPress {
  platform: PlatformType
  channelId: string
  threadId?: number
  messageId: string
  senderId: string
  senderName?: string
  senderUsername?: string
  senderIsBot?: boolean
  buttonId: string
  data?: string
}

export interface SendOptions {
  threadId?: number
}

export interface PlatformConfig {
  token?: string
  webhookUrl?: string
  webhookSecretToken?: string
  logger?: MessagingLogger
  [key: string]: unknown
}

export interface PlatformAdapter {
  readonly platform: PlatformType
  readonly capabilities: AdapterCapabilities
  initialize(config: PlatformConfig): Promise<void>
  destroy(): Promise<void>
  isConnected(): boolean
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void
  sendText(channelId: string, text: string, opts?: SendOptions): Promise<SentMessage>
  editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void>
  sendButtons(channelId: string, text: string, buttons: InlineButton[], opts?: SendOptions): Promise<SentMessage>
  sendTyping(channelId: string, opts?: SendOptions): Promise<void>
  sendFile(channelId: string, file: Buffer, filename: string, caption?: string, opts?: SendOptions): Promise<SentMessage>
  clearButtons?(channelId: string, messageId: string, opts?: SendOptions): Promise<void>
}

export type ResponseMode = 'streaming' | 'progress' | 'final_only'
export type BindingAccessMode = 'inherit' | 'allow-list' | 'open'

export interface BindingConfig {
  responseMode: ResponseMode
  streamResponses: boolean
  showToolActivity: boolean
  approvalChannel: 'chat' | 'app'
  editIntervalMs: number
  accessMode: BindingAccessMode
  allowedSenderIds: string[]
}

export const DEFAULT_BINDING_CONFIG: BindingConfig = {
  responseMode: 'progress',
  streamResponses: true,
  showToolActivity: false,
  approvalChannel: 'chat',
  editIntervalMs: 3500,
  accessMode: 'inherit',
  allowedSenderIds: [],
}

export function getDefaultBindingConfig(_platform: PlatformType): BindingConfig {
  return { ...DEFAULT_BINDING_CONFIG }
}

export function normalizeBindingConfig(
  platform: PlatformType,
  config?: Partial<BindingConfig>,
): BindingConfig {
  const base = getDefaultBindingConfig(platform)
  const responseMode: ResponseMode = config?.responseMode
    ?? (config?.streamResponses === false
      ? 'final_only'
      : config?.streamResponses === true ? 'streaming' : base.responseMode)
  return {
    ...base,
    ...config,
    responseMode,
    approvalChannel: config?.approvalChannel ?? base.approvalChannel,
    accessMode: config?.accessMode ?? (config ? 'open' : base.accessMode),
    allowedSenderIds: Array.isArray(config?.allowedSenderIds) ? [...config.allowedSenderIds] : [],
  }
}

export interface ChannelBinding {
  id: string
  workspaceId: string
  sessionId: string
  platform: PlatformType
  channelId: string
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
  config: BindingConfig
}

export type PlatformAccessMode = 'open' | 'owner-only'

export interface PlatformOwner {
  userId: string
  displayName?: string
  username?: string
  addedAt: number
}

export type PendingRejectReason = 'not-owner' | 'not-on-binding-allowlist'

export interface PendingSender {
  platform: PlatformType
  userId: string
  displayName?: string
  username?: string
  lastAttemptAt: number
  attemptCount: number
  reason?: PendingRejectReason
  bindingId?: string
  sessionId?: string
  channelId?: string
  threadId?: number
}

export interface MessagingConfig {
  enabled: boolean
  platforms: {
    lark?: {
      enabled: boolean
      domain?: 'lark' | 'feishu'
      accessMode?: PlatformAccessMode
      owners?: PlatformOwner[]
    }
  }
}

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
  enabled: false,
  platforms: {},
}
