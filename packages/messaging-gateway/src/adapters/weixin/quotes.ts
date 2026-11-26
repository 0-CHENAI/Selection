import { createHash } from 'node:crypto'

export type QuoteSource = { sessionId: string; kind: 'answer' | 'completion' | 'clarification' }
export type StoredQuote = QuoteSource & { peer: string; serverId?: string; text: string }
export interface WeixinReference {
  svr_id?: string
  title?: string
  message_item?: { msg_id?: string; text_item?: { text?: string } }
}

export function resolveQuote(records: StoredQuote[], peer: string, ref: WeixinReference) {
  const id = ref.svr_id || ref.message_item?.msg_id
  const body = ref.message_item?.text_item?.text || ref.title
  const byPeer = records.filter(r => r.peer === peer)
  const byId = id && byPeer.find(r => r.serverId === id)
  if (byId) return byId
  // Older responses can have no server ID. Only match a complete, unambiguous
  // sent message. A truncated title or a conflicting ID cannot select a chat.
  const matches = byPeer.filter(r => r.text === body)
  if (id && matches.some(r => r.serverId)) return
  const first = matches[0]
  if (first && matches.every(r => r.sessionId === first.sessionId && r.kind === first.kind)) return first
}

export function quoteTurnPrefix(channel: string) {
  return 'weixin-quote-' + createHash('sha256').update(channel).digest('hex') + '/'
}
