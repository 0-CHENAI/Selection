import { expect, test } from 'bun:test'
import { processEvent } from '../../processor'
import type { SessionState } from '../../types'

test('a later artifact review updates only the committed answer without replaying its text', () => {
  const state = { session: { id: 'session', messages: [
    { id: 'answer', role: 'assistant', content: '报告完成', featuredArtifacts: [] },
    { id: 'other', role: 'assistant', content: '旧答案' },
  ] }, streaming: null } as SessionState
  const pending = processEvent(state, { type: 'artifact_selection_updated', sessionId: 'session', messageId: 'answer',
    artifactReviewStatus: 'pending' })
  expect(pending.state.session.messages[0]).toMatchObject({ content: '报告完成', artifactReviewStatus: 'pending', featuredArtifacts: [] })
  const next = processEvent(pending.state, { type: 'artifact_selection_updated', sessionId: 'session', messageId: 'answer',
    artifactReviewStatus: 'complete', featuredArtifacts: ['C:\\Users\\张三\\报告.html'] })
  expect(next.state.session.messages[0]).toMatchObject({ content: '报告完成', artifactReviewStatus: 'complete', featuredArtifacts: ['C:\\Users\\张三\\报告.html'] })
  expect(next.state.session.messages[1]).toBe(state.session.messages[1])
  const failed = processEvent(pending.state, { type: 'artifact_selection_updated', sessionId: 'session', messageId: 'answer',
    artifactReviewStatus: 'failed' })
  expect(failed.state.session.messages[0]).toMatchObject({ content: '报告完成', artifactReviewStatus: 'failed', featuredArtifacts: [] })
})
