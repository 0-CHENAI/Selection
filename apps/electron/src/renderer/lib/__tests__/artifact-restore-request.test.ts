import { expect, test } from 'bun:test'
import type { ManagedArtifact } from '@craft-agent/shared/protocol'
import { buildArtifactRestoreRequest } from '../artifact-restore-request'

test('restore request carries exact target and expected current version into chat', () => {
  const record = { id: 'artifact', path: '/workspace/report.docx', currentVersion: 'v2', versions: [
    { id: 'v1', ordinal: 1 }, { id: 'v2', ordinal: 2 },
  ] } as ManagedArtifact
  const message = buildArtifactRestoreRequest(record, 'v1')
  expect(message).toContain('恢复到第 1 版')
  expect(message).toContain('"artifactId":"artifact"')
  expect(message).toContain('"versionId":"v1"')
  expect(message).toContain('"expectedVersion":"v2"')
  expect(() => buildArtifactRestoreRequest(record, 'v2')).toThrow()
})
