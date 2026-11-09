interface MergeMessage {
  id: string
  role?: string
  content?: string
  clientMessageId?: string
  isPending?: boolean
}

/**
 * session_created replaces the renderer session with the disk copy. Keep
 * optimistic rows the server has not echoed yet so the transcript does not
 * flash empty. A pending row whose text is already on the server is the
 * same send, so it is not appended twice.
 */
export function mergeCreatedSessionMessages<T extends MergeMessage>(
  local: readonly T[] | undefined,
  remote: readonly T[],
): T[] {
  if (!local?.length) return [...remote]
  const remoteIds = new Set<string>()
  for (const message of remote) {
    remoteIds.add(message.id)
    if (message.clientMessageId) remoteIds.add(message.clientMessageId)
  }
  const extras = local.filter(message => {
    if (remoteIds.has(message.id)) return false
    if (message.clientMessageId && remoteIds.has(message.clientMessageId)) return false
    if (message.role === 'user' && message.isPending) {
      const echoed = remote.some(other => other.role === 'user' && other.content === message.content)
      if (echoed) return false
    }
    return true
  })
  return extras.length ? [...remote, ...extras] : [...remote]
}
