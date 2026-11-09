import type { ArtifactRecord } from './artifact-versions'
import type { FeedbackStore } from './feedback-store'

/** Unknown source executions stay protected until their lifecycle is resolved. */
export function runtimeProtectedVersions(record: ArtifactRecord, feedback: FeedbackStore, isRunSettled: (runId: string) => boolean): string[] {
  return [...new Set([
    ...feedback.protectedVersions(record.id),
    ...record.versions.filter(version => version.sourceRunId && !isRunSettled(version.sourceRunId)).map(version => version.id),
  ])]
}
