import { expect, test } from 'bun:test'
import type { ArtifactFeedback } from '@craft-agent/shared/protocol'
import { latestArtifactFeedback, mergeArtifactFeedbackHistory, updateSelectedArtifactFeedback } from './artifact-feedback-state'
const running: ArtifactFeedback = { version: 1, id: 'a', sessionId: 's', artifactId: 'file', baseVersion: 'v', instruction: 'revise', status: 'running', createdAt: 1, updatedAt: 10, revision: 2 }
test('delayed history cannot overwrite a newer terminal status even when timestamps tie or move backward', () => {
  const applied = { ...running, status: 'applied' as const, revision: 3, updatedAt: 9 }
  expect(latestArtifactFeedback(running, applied)).toBe(applied)
  expect(latestArtifactFeedback(applied, running)).toBe(applied)
  expect(mergeArtifactFeedbackHistory([applied], [running])).toEqual([applied])
  expect(mergeArtifactFeedbackHistory([running], [applied])).toEqual([applied])
})
test('legacy timestamps remain supported and cannot overwrite a revisioned record', () => {
  const old = { ...running, revision: undefined }
  const newer = { ...old, updatedAt: 11 }
  expect(latestArtifactFeedback(old, newer)).toBe(newer)
  expect(latestArtifactFeedback(running, newer)).toBe(running)
  expect(mergeArtifactFeedbackHistory([running], [{ ...newer, id: 'b', createdAt: 2 }]).map(item => item.id)).toEqual(['b', 'a'])
})


test('late cancel and polling responses neither change selection nor undo a resolved revision', () => {
  const resolved = { ...running, status: 'applied' as const, revision: 4, userResolved: true }
  const late = { ...running, status: 'applied' as const, revision: 3 }
  expect(updateSelectedArtifactFeedback(resolved, late)).toBe(resolved)
  const selected = { ...running, id: 'another' }
  expect(updateSelectedArtifactFeedback(selected, late)).toBe(selected)
  expect(updateSelectedArtifactFeedback(undefined, late)).toBeUndefined()
  expect(mergeArtifactFeedbackHistory([resolved, selected], [late])).toContainEqual(resolved)
})
