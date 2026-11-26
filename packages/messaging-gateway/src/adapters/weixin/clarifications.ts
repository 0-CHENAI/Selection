import { createHash } from 'node:crypto'
import type { ClarificationState, Message } from '@craft-agent/core/types'
import { clarificationQuestions, type ClarificationResponseInput } from '@craft-agent/shared/agent/clarification'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { Session } from '@craft-agent/shared/protocol'
import type { WeixinAdapter } from './index'
import { isWeixinConversation, weixinSessionTitle } from './session-picker'
import { splitText } from '../../renderer'
import type { BindingStore } from '../../binding-store'
import type { IncomingMessage, MessagingConfig, MessagingLogger } from '../../types'

function shortId(id: string) {
  return createHash('sha256').update(id).digest('hex').slice(0, 6)
}

function promptText(code: string, ask: ClarificationState): string {
  const questions = clarificationQuestions(ask)
  const rows = questions.map((q, i) => [
    `${i + 1}. ${q.question}（${q.selection === 'multi' ? '多选' : '单选'}）`,
    ...q.options.map((o, n) => `  ${n + 1}) ${o.label}`),
  ].join('\n'))
  const sample = questions.map(q => q.options.length ? '1' : '你的回答').join('\n')
  return [...rows,
    '回复选项编号，多选用逗号隔开。也可直接写答案，或用“1 + 说明”补充选项。回复“跳过”可跳过该题。' +
      (questions.length > 1 ? '请按题目顺序每题写一行；“全部跳过”会跳过整组。' : ''),
    `也可以引用这条消息，回复“答 回答内容”。\n回复格式：\n/答 ${code} ${sample}`].join('\n\n')
}

export function parseWeixinAnswers(ask: ClarificationState, input: string): ClarificationResponseInput | string {
  if (input.trim() === '全部跳过') return { skipped: true }
  const questions = clarificationQuestions(ask)
  const lines = questions.length === 1 ? [input.trim()] : input.trim().split(/\r?\n/).map(s => s.trim())
  if (lines.length !== questions.length) return `请按顺序每题写一行，共 ${questions.length} 行。不回答的题写“跳过”。`
  const answers = []
  for (const [i, q] of questions.entries()) {
    const line = lines[i]!
    if (!line) return `第 ${i + 1} 题还没有答案，可填写“跳过”。`
    if (line === '跳过') {
      answers.push({ questionId: q.id, skipped: true })
      continue
    }
    // “文字：” allows literal numeric answers and reserved words.
    const literal = /^文字[:：]\s*([\s\S]*)$/.exec(line)
    const numbered = !literal && q.options.length ? /^(\d+(?:\s*[,，、]\s*\d+)*)(?:\s*\+\s*([\s\S]*))?$/.exec(line) : null
    const indexes = numbered ? [...new Set(numbered[1]!.split(/[,，、]/).map(Number))] : []
    if (indexes.some(n => n < 1 || n > q.options.length) || (q.selection === 'single' && indexes.length > 1)) {
      return `第 ${i + 1} 题的编号无效，请按列出的${q.selection === 'single' ? '单个' : ''}选项编号重答；纯数字文字答案请以“文字：”开头。`
    }
    const text = (numbered ? numbered[2] ?? '' : literal ? literal[1]! : line).trim()
    if ((!text && !indexes.length) || text.length > 2000) return `请检查第 ${i + 1} 题的文字答案（最多 2000 字）。`
    answers.push({ questionId: q.id, skipped: false, optionIds: indexes.map(n => q.options[n - 1]!.id), text })
  }
  return { answers }
}

export class WeixinClarifications {
  constructor(private readonly workspaceId: string, private readonly sessions: ISessionManager,
    private readonly bindings: BindingStore, private readonly config: () => MessagingConfig,
    private readonly log: MessagingLogger) {}

  private eligible(session: Session, channel: string): boolean {
    if (session.workspaceId !== this.workspaceId || !isWeixinConversation(session)) return false
    const config = this.config()
    const wx = config.platforms.weixin
    if (!config.enabled || !wx?.enabled) return false
    const peer = JSON.parse(channel)[1] as string
    if (wx.accessMode === 'owner-only' && !wx.owners?.some(owner => owner.userId === peer)) return false
    const binding = this.bindings.findByChannel('weixin', channel)
    if (binding?.sessionId === session.id) {
      return binding.config.accessMode !== 'allow-list' || binding.config.allowedSenderIds.includes(peer)
    }
    return wx.notifyOnCompletion === true
  }

  async publish(adapter: WeixinAdapter, sessionId: string, message?: Message) {
    const channel = adapter.getOwnerChannel()
    const ask = message?.clarification
    if (!channel || !adapter.isConnected() || ask?.status !== 'pending') return
    const workspaceSessions = this.sessions.getSessions(this.workspaceId)
    if (ask.mirror ? !workspaceSessions.some(s => s.id === ask.originSessionId && s.workspaceId === this.workspaceId) : ask.originSessionId !== sessionId) return
    const session = workspaceSessions.find(s => s.id === sessionId)
    if (!session || !this.eligible(session, channel)) return
    const code = shortId(sessionId) + shortId(ask.requestId)
    const header = `「${weixinSessionTitle(session)}」\n【澄清 ${code}】\n`
    for (const chunk of splitText(promptText(code, ask), adapter.capabilities.maxMessageLength - header.length)) {
      if (channel !== adapter.getOwnerChannel() || !this.eligible(session, channel)) return
      await adapter.sendText(channel, header + chunk, { weixinSource: { sessionId, kind: 'clarification' } })
    }
  }

  async handle(adapter: WeixinAdapter, msg: IncomingMessage): Promise<boolean> {
    if (!/^\/答(?:\s|$)/.test(msg.text)) return false
    const channel = adapter.getOwnerChannel()
    if (!channel || channel !== msg.channelId || JSON.parse(channel)[1] !== msg.senderId) return true
    const reply = (text: string) => adapter.sendText(channel, text)
    const command = /^\/答\s+([0-9a-f]{12})\s+([\s\S]+)$/i.exec(msg.text.trim())
    if (!command) {
      await reply('请使用问题消息末尾的回复格式：/答 答复码 答案。')
      return true
    }
    const code = command[1]!.toLowerCase()
    // Derive the address from persisted session/card IDs. No transient "current question"
    // can redirect a delayed answer after a restart, rebind, or simultaneous request.
    const candidates = this.sessions.getSessions(this.workspaceId).filter(s =>
      shortId(s.id) === code.slice(0, 6) && this.eligible(s, channel))
    const session = candidates.length === 1 ? await this.sessions.getSession(candidates[0]!.id) : null
    const cards = session?.messages.filter(m => m.role === 'clarification').map(m => m.clarification).filter((q): q is ClarificationState =>
      !!q && shortId(q.requestId) === code.slice(6)) ?? []
    const ask = cards.length === 1 ? cards[0] : undefined
    if (!session || !this.eligible(session, channel) || !ask || ask.status !== 'pending') {
      await reply('这组问题已处理，或当前微信无法回答。请查看最新的问题消息。')
      return true
    }
    const response = parseWeixinAnswers(ask, command[2]!)
    if (typeof response === 'string') {
      await reply(response + `\n请重新发送：/答 ${code} 答案`)
      return true
    }
    if (ask.mirror) {
      // Load the persisted origin too: the session manager settles the root and
      // worker together, including when a reply arrives after restarting.
      const origin = await this.sessions.getSession(ask.originSessionId)
      if (origin?.workspaceId !== this.workspaceId || !origin.messages.some(m =>
        m.clarification?.requestId === ask.requestId && !m.clarification.mirror && m.clarification.status === 'pending')) {
        await reply('原会话的问题已处理或无法继续。')
        return true
      }
    }
    if (!adapter.isConnected() || adapter.getOwnerChannel() !== channel || !this.eligible(session, channel)) return true
    // Resuming may run the model for minutes. Keep the WeChat inbox available
    // for subsequent questions while the session manager owns the continuation.
    void this.sessions.respondToClarification(session.id, ask.requestId, response)
      .then(async ok => {
        if (adapter.isConnected() && adapter.getOwnerChannel() === channel) {
          await reply(ok ? `「${weixinSessionTitle(session)}」已收到你的答复。` : '答复未提交，请查看最新的问题消息或桌面端的问题状态。')
        }
      })
      .catch(error => this.log.warn('WeChat clarification response failed', { sessionId: session.id, error: String(error) }))
    return true
  }
}
