import * as React from 'react'

export interface ComposerEnterState {
  sessionId: string | null
  ready: boolean
  seenIds: string[]
  enteringIds: string[]
}

export interface ComposerEnterInput {
  sessionId: string | null
  messagesLoading: boolean
  userIds: readonly string[]
}

const empty: ComposerEnterState = { sessionId: null, ready: false, seenIds: [], enteringIds: [] }

/** History and session switches stay still. A user message added after the transcript is ready floats in. */
export function reduceComposerEnter(state: ComposerEnterState, input: ComposerEnterInput): ComposerEnterState {
  if (state.sessionId !== input.sessionId) {
    return {
      sessionId: input.sessionId,
      ready: !input.messagesLoading,
      seenIds: input.messagesLoading ? [] : [...input.userIds],
      enteringIds: [],
    }
  }
  if (!state.ready) {
    if (input.messagesLoading) return state.enteringIds.length === 0 ? state : { ...state, enteringIds: [] }
    return { ...state, ready: true, seenIds: [...input.userIds], enteringIds: [] }
  }
  const seen = new Set(state.seenIds)
  const entering = input.userIds.filter(id => !seen.has(id))
  if (entering.length === 0) return state
  return { ...state, seenIds: [...state.seenIds, ...entering], enteringIds: entering }
}

export function useComposerEnter(input: ComposerEnterInput): ReadonlySet<string> {
  const [state, setState] = React.useState<ComposerEnterState>(() => reduceComposerEnter(empty, {
    ...input,
    messagesLoading: true,
  }))
  const next = reduceComposerEnter(state, input)
  if (next !== state) setState(next)
  React.useEffect(() => {
    if (state.enteringIds.length === 0) return
    const timer = window.setTimeout(() => {
      setState(current => current.enteringIds.length === 0 ? current : { ...current, enteringIds: [] })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [state.enteringIds])
  return React.useMemo(() => new Set(state.enteringIds), [state.enteringIds])
}

export function initialComposerEnterState(): ComposerEnterState {
  return empty
}
