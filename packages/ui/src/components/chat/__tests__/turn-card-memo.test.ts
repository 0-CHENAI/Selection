import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { TurnCardProps } from '../TurnCard'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let turnCardPropsAreEqual: typeof import('../TurnCard').turnCardPropsAreEqual

beforeAll(async () => {
  ;({ turnCardPropsAreEqual } = await import('../TurnCard'))
})

const emptyActivities: TurnCardProps['activities'] = []

function card(patch: Partial<TurnCardProps> = {}): TurnCardProps {
  return {
    turnId: 'turn-1',
    sessionId: 'session-1',
    activities: emptyActivities,
    isStreaming: false,
    isComplete: true,
    ...patch,
  }
}

describe('turnCardPropsAreEqual', () => {
  test('skips finished historical cards when only the streaming tail changed', () => {
    const previous = card()
    const next = card()
    expect(turnCardPropsAreEqual(previous, next)).toBe(true)
    expect(turnCardPropsAreEqual(previous, card({ isStreaming: true, isComplete: false }))).toBe(false)
    expect(turnCardPropsAreEqual(previous, card({ activities: [{ id: 't', type: 'tool', status: 'completed', timestamp: 1 }] }))).toBe(false)
  })

  test('re-renders when todos on a finished card change identity', () => {
    const todos = [{ id: 'a', content: 'x', status: 'completed' as const }]
    expect(turnCardPropsAreEqual(card({ todos }), card({ todos }))).toBe(true)
    expect(turnCardPropsAreEqual(card({ todos }), card({ todos: [...todos] }))).toBe(false)
  })
})
