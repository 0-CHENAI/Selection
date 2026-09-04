import { describe, expect, test } from 'bun:test'
import type { TaskApplyRunRevisionResult } from '@craft-agent/shared/protocol'
import { canConfirmRunRevision, revisionRequiresV3Ack } from '../ApplyRunRevisionDialog'
import { runtimeNodesForDefinition } from '../ConductorWorkbench'

function preview(overrides: Partial<TaskApplyRunRevisionResult> = {}): TaskApplyRunRevisionResult {
  return {
    diff: { added: ['new-node'], removed: [], changed: [] },
    validation: { valid: true, errors: [], warnings: [] },
    yaml: 'schema_version: 2\n',
    runRevision: 1,
    runSpecHash: 'hash-1',
    ...overrides,
  }
}

describe('canConfirmRunRevision', () => {
  test('requires a valid preview with generated YAML', () => {
    expect(canConfirmRunRevision(null)).toBe(false)
    expect(canConfirmRunRevision(preview({ yaml: undefined }))).toBe(false)
    expect(canConfirmRunRevision(preview({ validation: { valid: false, errors: [], warnings: [] } }))).toBe(false)
    expect(canConfirmRunRevision(preview())).toBe(true)
    expect(canConfirmRunRevision(preview({ diff: { added: [], removed: [], changed: [] } }))).toBe(false)
    expect(canConfirmRunRevision(preview({ runSpecHash: undefined }))).toBe(false)
  })

  test('fails closed when the preview reports an ETag conflict', () => {
    expect(canConfirmRunRevision(preview({
      conflict: { code: 'etag-conflict', expected: 'old', actual: 'new' },
    }))).toBe(false)
  })

  test('requires an explicit v3 acknowledgement when migration warnings are present', () => {
    expect(revisionRequiresV3Ack(preview())).toBe(false)
    expect(revisionRequiresV3Ack(preview({ migrationWarnings: ['v2 cache:pure becomes run-pure'] }))).toBe(true)
  })
})

describe('runtimeNodesForDefinition', () => {
  test('includes direct and dynamic instances without matching prefix siblings', () => {
    const nodes = [
      { id: 'map', state: 'done', attempt: 1 },
      { id: 'map#0', definitionId: 'map', state: 'done', attempt: 1 },
      { id: 'generated-1', definitionId: 'map', state: 'running', attempt: 2 },
      { id: 'map-extra#0', definitionId: 'map-extra', state: 'done', attempt: 1 },
    ]
    expect(runtimeNodesForDefinition(nodes, 'map').map((node) => node.id)).toEqual(['map', 'map#0', 'generated-1'])
  })
})
