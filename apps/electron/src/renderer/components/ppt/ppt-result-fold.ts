import { useCallback, useEffect, useState } from 'react'
import * as storage from '../../lib/local-storage'

const MAX_SESSIONS = 100
const MAX_MESSAGES = 40

export interface PptFoldMap {
  [sessionId: string]: { messages: string[]; lastAccessed: number }
}

export function pptResultMessageId(messages: Array<{ id?: string; clientMessageId?: string; role?: string; isQueued?: boolean }> | undefined): string | undefined {
  if (!messages) return undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== 'user' || message.isQueued) continue
    const id = message.clientMessageId || message.id
    if (id) return id
  }
  return undefined
}

export function pptFoldExpanded(map: PptFoldMap, sessionId: string | undefined, messageId: string | undefined): boolean {
  if (!sessionId || !messageId) return false
  return !!map[sessionId]?.messages.includes(messageId)
}

export function prunePptFolds(map: PptFoldMap, maxSessions = MAX_SESSIONS): PptFoldMap {
  const entries = Object.entries(map)
  if (entries.length <= maxSessions) return map
  entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
  const pruned: PptFoldMap = {}
  for (const [key, value] of entries.slice(entries.length - maxSessions)) pruned[key] = value
  return pruned
}

/** Absent means collapsed. Only an explicit expand is stored, and only for that message. */
export function rememberPptFold(map: PptFoldMap, sessionId: string, messageId: string, expanded: boolean, now = Date.now()): PptFoldMap {
  const next: PptFoldMap = { ...map }
  const messages = (next[sessionId]?.messages ?? []).filter(id => id !== messageId)
  if (expanded) messages.push(messageId)
  if (messages.length === 0) delete next[sessionId]
  else next[sessionId] = { messages: messages.slice(-MAX_MESSAGES), lastAccessed: now }
  return prunePptFolds(next)
}

function readMap(): PptFoldMap {
  const map = storage.get<PptFoldMap>(storage.KEYS.pptResultFold, {})
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {}
}

function readMessages(sessionId: string | undefined): string[] {
  if (!sessionId) return []
  const messages = readMap()[sessionId]?.messages
  return Array.isArray(messages) ? messages.filter(id => typeof id === 'string' && id) : []
}

export function usePptResultExpanded(sessionId: string | undefined, messageId: string | undefined) {
  const [messages, setMessages] = useState<string[]>(() => readMessages(sessionId))
  const [stateSessionId, setStateSessionId] = useState(sessionId)
  if (stateSessionId !== sessionId) {
    setStateSessionId(sessionId)
    setMessages(readMessages(sessionId))
  }
  const [orphan, setOrphan] = useState(false)
  const [orphanMessageId, setOrphanMessageId] = useState(messageId)
  if (orphanMessageId !== messageId) {
    setOrphanMessageId(messageId)
    setOrphan(false)
  }

  useEffect(() => {
    if (!sessionId || stateSessionId !== sessionId) return
    const map = { ...readMap() }
    if (messages.length === 0) delete map[sessionId]
    else map[sessionId] = { messages, lastAccessed: Date.now() }
    storage.set(storage.KEYS.pptResultFold, prunePptFolds(map))
  }, [sessionId, stateSessionId, messages])

  const expanded = messageId ? messages.includes(messageId) : orphan
  const setExpanded = useCallback((next: boolean) => {
    if (!messageId) {
      setOrphan(next)
      return
    }
    setMessages(prev => {
      const without = prev.filter(id => id !== messageId)
      const updated = next ? [...without, messageId].slice(-MAX_MESSAGES) : without
      if (updated.length === prev.length && updated.every((id, index) => id === prev[index])) return prev
      return updated
    })
  }, [messageId])

  return [expanded, setExpanded] as const
}
