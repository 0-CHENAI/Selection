import type { Message } from '@craft-agent/core/types'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { SessionCompletionEvent } from '@craft-agent/server-core/sessions'
import type { Session } from '@craft-agent/shared/protocol'
import { evaluateBindingAccess, evaluatePreBindingAccess } from '../../access-control'
import type { BindingStore } from '../../binding-store'
import { isVisibleAnswerText, splitText, type SessionEvent } from '../../renderer'
import type { IncomingMessage, MessagingConfig, MessagingLogger } from '../../types'
import type { WeixinAdapter } from './index'
import { isWeixinConversation, weixinSessionTitle } from './session-picker'
import { waitForWeixinAdmission } from './admission'
import { quoteTurnPrefix } from './quotes'

interface QuotedTurn {
  channel: string
  clientId: string
  parts: string[]
}

function visibleAnswer(message: Message) {
  return message.role === 'assistant' && isVisibleAnswerText(message) && !!message.content?.trim()
}

export class WeixinConversations {
  private readonly turns = new Map<string, QuotedTurn>()
  private readonly lastCompletion = new Map<string, number>()

  constructor(private readonly workspaceId: string, private readonly sessions: ISessionManager,
    private readonly bindings: BindingStore, private readonly config: () => MessagingConfig,
    private readonly log: MessagingLogger) {}

  private session(id: string, candidates = this.sessions.getSessions(this.workspaceId)) {
    return candidates.find(s => s.id === id && s.workspaceId === this.workspaceId && isWeixinConversation(s))
  }

  canDeliver(adapter: WeixinAdapter, channel: string, id: string, bindingId?: string) {
    const workspaceConfig = this.config()
    if (!workspaceConfig.enabled || !workspaceConfig.platforms.weixin?.enabled || !adapter.isConnected() || adapter.getOwnerChannel() !== channel) return false
    const msg = { senderId: JSON.parse(channel)[1] as string, platform: 'weixin' as const }
    const binding = this.bindings.findByChannel('weixin', channel)
    if (bindingId && binding?.id !== bindingId) return false
    return evaluatePreBindingAccess({ msg, workspaceConfig }).allow &&
      (binding?.sessionId !== id || evaluateBindingAccess({ msg, binding, workspaceConfig }).allow)
  }

  async handleQuote(adapter: WeixinAdapter, msg: IncomingMessage, switchSession: (id: string) => Promise<void>) {
    const quote = msg.weixinQuote
    if (!quote) return false
    const session = this.session(quote.sessionId)
    if (!session || !this.canDeliver(adapter, msg.channelId, session.id)) {
      await adapter.sendText(msg.channelId, '该会话已移出工作区或当前不可访问。请发送 /bind 重新选择。')
      return true
    }
    if (msg.text === '切换') {
      await switchSession(session.id)
      return true
    }
    if (quote.kind === 'completion' && msg.text === '查看最新回复') {
      const history = await this.sessions.getSession(session.id)
      if (!this.canDeliver(adapter, msg.channelId, session.id) || !history || history.workspaceId !== this.workspaceId || !isWeixinConversation(history)) return true
      const answer = history.messages.findLast(visibleAnswer)
      if (answer) await this.sendAnswer(adapter, msg.channelId, history, answer.content)
      else await adapter.sendText(msg.channelId, '这个会话还没有可展示的最终回复。')
      return true
    }
    const clientId = quoteTurnPrefix(msg.channelId) + msg.messageId
    const reportFailure = async (error: unknown) => {
      this.log.warn('WeChat quoted question failed', { sessionId: session.id, error: String(error) })
      if (this.canDeliver(adapter, msg.channelId, session.id)) {
        await adapter.sendText(msg.channelId, '这条追问处理失败，请查看会话状态。')
          .catch(err => this.log.warn('WeChat error delivery failed', { sessionId: session.id, error: String(err) }))
      }
    }
    await waitForWeixinAdmission(
      ack => this.sessions.sendMessage(session.id, msg.text, undefined, undefined, { optimisticMessageId: clientId }, undefined, undefined, ack),
      reportFailure,
    ).catch(reportFailure)
    return true
  }

  private flush(adapter: WeixinAdapter, sessionId: string, turn: QuotedTurn) {
    const body = turn.parts.join('\n\n')
    turn.parts = []
    const session = body && this.session(sessionId)
    if (!session) return
    void this.sendAnswer(adapter, turn.channel, session, body)
      .catch(error => this.log.warn('WeChat quoted answer delivery failed', { sessionId, error: String(error) }))
  }

  private async sendAnswer(adapter: WeixinAdapter, channel: string, session: Session, body: string, completed = false) {
    const title = `「${weixinSessionTitle(session)}」`
    const heading = completed ? title + '本轮任务已完成。\n\n' : title + '\n'
    const switchHint = session.id.length <= 120 ? `也可发送 /bind ${session.id}` : ''
    const hint = completed ? `\n\n引用这条消息可追问。要切换会话，引用后回复“切换”。${switchHint}` : ''
    const chunks = splitText(body.trim(), adapter.capabilities.maxMessageLength - heading.length - hint.length)
    for (const [i, chunk] of chunks.entries()) {
      if (!this.canDeliver(adapter, channel, session.id) || (completed && !this.config().platforms.weixin?.notifyOnCompletion)) return
      const prefix = i === 0 ? heading : title + '\n'
      const text = prefix + chunk + (i === chunks.length - 1 ? hint : '')
      await adapter.sendText(channel, text, { weixinSource: { sessionId: session.id, kind: 'answer' } })
    }
  }

  // Follow the admitted user turn, including queue promotion. The persistent
  // binding remains available to unrelated messages arriving from the phone.
  onEvent(adapter: WeixinAdapter, event: SessionEvent): boolean {
    const id = event.sessionId
    const turn = this.turns.get(id)
    if (event.type === 'user_message' && (event.status === 'accepted' || event.status === 'processing')) {
      const message = event.message as Message | undefined
      if (message?.hidden) return false
      const clientId = message?.clientMessageId ?? event.optimisticMessageId
      if (turn && turn.clientId === clientId) return false
      if (turn) this.flush(adapter, id, turn)
      this.turns.delete(id)
      const channel = adapter.getOwnerChannel()
      if (channel && typeof clientId === 'string' && clientId.startsWith(quoteTurnPrefix(channel))) {
        this.turns.set(id, { channel, clientId, parts: [] })
      }
      return false
    }
    if (!turn) return false
    if (event.type === 'text_complete') {
      if (isVisibleAnswerText(event) && typeof event.text === 'string' && event.text.trim()) turn.parts.push(event.text.trim())
      return true
    }
    if (event.type === 'complete') {
      if (event.orchestrationPending) turn.parts = []
      else this.flush(adapter, id, turn)
      return true
    }
    return event.type === 'text_delta'
  }

  async completed(adapter: WeixinAdapter, event: SessionCompletionEvent) {
    const id = event.sessionId
    const channel = adapter.getOwnerChannel()
    const turn = this.turns.get(id)
    if (!turn && (!channel || !this.config().platforms.weixin?.notifyOnCompletion)) return
    const candidates = this.sessions.getSessions(this.workspaceId)
    const session = this.session(id, candidates)
    if (session?.isProcessing || session?.orchestrationStatus === 'running') return
    if ((this.lastCompletion.get(id) ?? -1) >= event.generation) return
    if (turn) {
      this.turns.delete(id)
      this.lastCompletion.set(id, event.generation)
      return
    }
    if (event.reason !== 'complete' || !session || (session.orchestrationStatus && session.orchestrationStatus !== 'completed') ||
        !channel || !this.canDeliver(adapter, channel, id)) return
    const bound = this.bindings.findByChannel('weixin', channel)
    if (bound?.sessionId === id || !candidates.some(s => s.workspaceId === this.workspaceId && s.id !== id && isWeixinConversation(s))) return
    this.lastCompletion.set(id, event.generation)
    try {
      // Completion can carry the previous final message ID when this turn has
      // no answer. Only publish the identified visible reply from this turn.
      const history = event.finalMessageId ? await this.sessions.getSession(id).catch(error => {
        this.log.warn('WeChat could not load completed reply', { sessionId: id, error: String(error) })
        return null
      }) : undefined
      if (history && (history.workspaceId !== this.workspaceId || !isWeixinConversation(history))) return
      if (!this.session(id) || !this.config().platforms.weixin?.notifyOnCompletion || !this.canDeliver(adapter, channel, id)) return
      const messages = history?.messages ?? []
      const lastUser = messages.findLastIndex(m => m.role === 'user' && !m.isQueued)
      const answer = messages.findLast((m, index) => index > lastUser && m.id === event.finalMessageId && visibleAnswer(m))
      if (answer) await this.sendAnswer(adapter, channel, session, answer.content, true)
      else await adapter.sendText(channel, `「${weixinSessionTitle(session)}」本轮任务已完成。\n引用这条提醒回复“切换”，或发送 /bind ${id}`, { weixinSource: { sessionId: id, kind: 'completion' } })
    } catch (error) {
      if (this.lastCompletion.get(id) === event.generation) this.lastCompletion.delete(id)
      throw error
    }
  }

  reset() {
    this.turns.clear()
    this.lastCompletion.clear()
  }
}
