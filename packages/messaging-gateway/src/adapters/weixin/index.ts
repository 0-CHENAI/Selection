import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { IncomingMessage, PlatformAdapter, SendOptions, SentMessage } from '../../types'
import { weixinRequest, WeixinApiError, type WeixinAccount } from './api'
import { resolveQuote, type StoredQuote, type WeixinReference } from './quotes'

interface Update {
  client_id?: string
  seq?: number
  message_id?: string | number
  from_user_id?: string
  message_type?: number
  group_id?: string
  create_time_ms?: number
  context_token?: string
  item_list?: Array<{ type: number; text_item?: { text?: string }; ref_msg?: WeixinReference }>
}

interface Inbox {
  cursor: string
  recent: string[]
  contextPeer?: string
  context?: string
}

export class WeixinAdapter implements PlatformAdapter {
  readonly platform = 'weixin'
  readonly capabilities = {
    messageEditing: false, inlineButtons: false, maxButtons: 0, maxMessageLength: 2000,
    markdown: 'plain' as const, webhookSupport: false,
  }
  private readonly controller = new AbortController()
  private readonly file: string
  private inbox: Inbox = { cursor: '', recent: [] }
  private quotes: StoredQuote[] = []
  private readonly sending = new Set<Promise<SentMessage>>()
  private loop?: Promise<void>
  private pausedUntil = 0
  private pendingReply?: { peer: string; context?: string }
  private failures = 0

  constructor(private readonly account: WeixinAccount, dir: string,
    private readonly runtime: (state: 'connecting' | 'connected' | 'reconnect_required') => void,
    private readonly pairedOwner: () => string | undefined) {
    // The chat is scoped to both ends, including when a workspace switches accounts.
    const inboxKey = JSON.stringify([account.botId, account.userId])
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'weixin-' + createHash('sha256').update(inboxKey).digest('hex') + '.json')
  }

  async initialize() {
    try {
      const saved: Inbox = JSON.parse(readFileSync(this.file, 'utf8'))
      if (typeof saved.cursor !== 'string' || !Array.isArray(saved.recent)) throw new Error('Invalid WeChat inbox')
      this.inbox = saved
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    try {
      const quotes = JSON.parse(readFileSync(this.file + '.quotes', 'utf8'))
      if (!Array.isArray(quotes)) throw new Error('Invalid WeChat quote history')
      this.quotes = quotes
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  isConnected() { return !this.controller.signal.aborted && Date.now() >= this.pausedUntil }
  async destroy() {
    this.controller.abort()
    await Promise.allSettled(this.sending)
    if (this.loop && Date.now() >= this.pausedUntil) await this.notify('stop')
  }

  private async notify(action: 'start' | 'stop') {
    // The official channel treats lifecycle notifications as best effort.
    await weixinRequest(this.account.baseUrl, 'msg/notify' + action, {
      token: this.account.token, body: {}, timeoutMs: 10_000,
      signal: action === 'start' ? this.controller.signal : undefined,
    }).catch(() => {})
  }
  onButtonPress() {}
  async sendTyping() {}
  async editMessage(): Promise<never> { throw new Error('WeChat messages cannot be edited') }
  async sendFile(): Promise<never> { throw new Error('WeChat supports text only') }
  sendButtons(channel: string, text: string) { return this.sendText(channel, text) }

  private contextFor(peer?: string) {
    const contextPeer = this.inbox.contextPeer ?? this.account.userId
    return peer && peer === contextPeer ? this.inbox.context : undefined
  }

  getOwnerChannel(): string | undefined {
    const owner = this.account.userId ?? this.pairedOwner()
    return owner ? JSON.stringify([this.account.botId, owner]) : undefined
  }

  async sendText(channel: string, text: string, opts?: SendOptions) {
    if (!this.isConnected()) throw new Error('WeChat connection is unavailable')
    const delivery = this.deliver(channel, text, opts)
    this.sending.add(delivery)
    try {
      return await delivery
    } finally {
      this.sending.delete(delivery)
    }
  }

  private async deliver(channel: string, text: string, opts?: SendOptions) {
    const owner = this.account.userId ?? this.pairedOwner()
    const target = this.pendingReply && channel === JSON.stringify([this.account.botId, this.pendingReply.peer])
      ? this.pendingReply : { peer: owner, context: this.contextFor(owner) }
    if (!target.peer || channel !== JSON.stringify([this.account.botId, target.peer])) throw new Error('Unknown WeChat chat')
    const id = randomUUID()
    const sent = await weixinRequest<{ message_id?: string }>(this.account.baseUrl, 'sendmessage', {
      // A send already submitted to WeChat can succeed during shutdown. Let
      // its bounded request finish so its server ID is durable before restart.
      token: this.account.token,
      body: { msg: { from_user_id: '', to_user_id: target.peer, client_id: id, message_type: 2,
        message_state: 2, context_token: target.context, item_list: [{ type: 1, text_item: { text } }] } },
    })
    if (opts?.weixinSource) {
      const quote = { ...opts.weixinSource, peer: target.peer, serverId: sent.message_id, text }
      const quotes = [...this.quotes.slice(-255), quote]
      writeFileSync(this.file + '.quotes.tmp', JSON.stringify(quotes), { mode: 0o600 })
      renameSync(this.file + '.quotes.tmp', this.file + '.quotes')
      this.quotes = quotes
    }
    return { platform: this.platform, channelId: channel, messageId: sent.message_id || id } as const
  }

  private save(next: Inbox) {
    writeFileSync(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
    this.inbox = next
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>) {
    this.loop ??= this.poll(handler)
  }

  private async poll(handler: (msg: IncomingMessage) => Promise<void>) {
    const { signal } = this.controller
    await this.notify('start')
    let pollTimeout = 35_000
    while (!signal.aborted) {
      let wait = 200
      try {
        const result = await weixinRequest<{ msgs?: Update[]; get_updates_buf?: string; longpolling_timeout_ms?: number }>(
          this.account.baseUrl, 'getupdates', { token: this.account.token, signal, timeoutMs: pollTimeout, body: { get_updates_buf: this.inbox.cursor } },
        )
        if (signal.aborted) return
        this.failures = 0
        if (this.pausedUntil) {
          this.pausedUntil = 0
          this.runtime('connected')
        }
        const ms = result.longpolling_timeout_ms
        if (ms && Number.isSafeInteger(ms) && ms > 0 && ms <= 2_147_483_647) pollTimeout = ms
        for (const msg of result.msgs ?? []) {
          if (signal.aborted) return
          const peer = msg.from_user_id
          if (!peer || msg.message_type !== 1 || msg.group_id) continue
          const owner = this.account.userId ?? this.pairedOwner()
          if (owner && peer !== owner) continue
          const text = msg.item_list?.filter(item => item.type === 1).map(item => item.text_item?.text).join('\n').trim()
          // Some confirmed logins omit ilink_user_id. Until a desktop-issued
          // code establishes ownership, only the existing /pair flow is allowed.
          if (!text || (!owner && !/^\/pair\s+\d{6}$/i.test(text))) continue
          const id = String(msg.message_id ?? msg.client_id ?? msg.seq ?? createHash('sha256')
            .update(JSON.stringify([this.inbox.cursor, result.msgs?.indexOf(msg), msg])).digest('hex'))
          const key = this.account.userId ? id : JSON.stringify([peer, id])
          if (this.inbox.recent.includes(key)) continue
          // Reserve before dispatch: re-delivery must not repeat an agent action.
          const context = msg.context_token || this.contextFor(peer)
          this.save({ ...this.inbox, recent: [...this.inbox.recent.slice(-999), key],
            ...(owner === peer ? { context, contextPeer: peer } : {}) })
          const quoted = msg.item_list?.find(item => item.ref_msg)?.ref_msg
          const source = quoted && resolveQuote(this.quotes, peer, quoted)
          const prompt = source?.kind === 'clarification' ? source.text : undefined
          const quotedCode = !source || prompt ? [prompt, quoted?.message_item?.text_item?.text, quoted?.title]
            .map(value => value?.match(/^(?:「[^\n]*」\n)?【澄清 ([0-9a-f]{12})】/i)?.[1]).find(Boolean) : undefined
          const answer = quoted && /^答\s+([\s\S]+)$/.exec(text)
          let routedText = text
          let weixinQuote: IncomingMessage['weixinQuote']
          if (source && source.kind !== 'clarification') {
            weixinQuote = { sessionId: source.sessionId, kind: source.kind }
          } else if (quotedCode && !text.startsWith('/')) {
            routedText = `/答 ${quotedCode} ${answer ? answer[1] : text}`
          } else if (quoted && !text.startsWith('/答 ')) {
            this.pendingReply = { peer, context }
            try { await this.sendText(JSON.stringify([this.account.botId, peer]), '无法定位这条引用。请发送 /bind 选择会话，或用问题中的 /答 命令作答。') }
            finally { this.pendingReply = undefined }
            continue
          }
          this.pendingReply = { peer, context }
          try {
            await handler({ platform: this.platform, channelId: JSON.stringify([this.account.botId, peer]),
              senderId: peer, senderName: peer, messageId: id, timestamp: msg.create_time_ms ?? Date.now(), text: routedText, weixinQuote, raw: {} })
            if (!signal.aborted && !owner && this.pairedOwner() === peer) this.save({ ...this.inbox, context, contextPeer: peer })
          } finally {
            this.pendingReply = undefined
          }
        }
        if (signal.aborted) return
        if (result.get_updates_buf && result.get_updates_buf !== this.inbox.cursor) {
          this.save({ ...this.inbox, cursor: result.get_updates_buf })
        }
      } catch (error) {
        if (signal.aborted) return
        if ((error as Error).name === 'TimeoutError') continue
        if (error instanceof WeixinApiError && error.code === -14) {
          wait = 60 * 60_000
          this.pausedUntil = Date.now() + wait
          this.failures = 0
          this.runtime('connecting')
        } else if (error instanceof WeixinApiError && [401, 403].includes(error.code)) {
          this.controller.abort()
          this.runtime('reconnect_required')
          return
        } else {
          this.failures++
          wait = this.failures % 3 === 0 ? 30_000 : 2_000
        }
      }
      await delay(wait, undefined, { signal }).catch(() => {})
    }
  }
}
