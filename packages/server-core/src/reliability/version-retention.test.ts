import { expect, test } from 'bun:test'
import { runtimeProtectedVersions } from './version-retention'
import type { ArtifactRecord } from './artifact-versions'
import type { FeedbackStore } from './feedback-store'

test('retention combines legacy feedback with running and unknown execution sources', () => {
  const record = { id: 'artifact', versions: [
    { id: 'manual' }, { id: 'running-version', sourceRunId: 'running' },
    { id: 'unknown-version', sourceRunId: 'unknown' }, { id: 'settled-version', sourceRunId: 'settled' },
  ] } as ArtifactRecord
  const feedback = { protectedVersions: () => ['manual', 'settled-version'] } as unknown as FeedbackStore
  expect(runtimeProtectedVersions(record, feedback, run => run === 'settled').sort()).toEqual(['manual', 'settled-version', 'running-version', 'unknown-version'].sort())
})
