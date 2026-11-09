import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession } from '../storage.ts'

describe('session persistence: managed Swarm aggregation', () => {
  it('restores the run-bound final aggregation contract', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-swarm-aggregation-'))
    const contract = {
      orchestrationId: 'orch-persisted',
      finalAggregation: 'Reconcile all worker evidence.',
      phase: 'awaiting-aggregation' as const,
      repairAttempts: 0,
      workers: [{
        sessionId: 'worker-a',
        status: 'completed' as const,
        finalMessageId: 'message-a',
      }],
    }
    try {
      const session = await createSession(workspaceRoot, {
        orchestrationId: contract.orchestrationId,
        orchestrationStatus: 'running',
        orchestrationAggregation: contract,
      })

      expect(loadSession(workspaceRoot, session.id)?.orchestrationAggregation).toEqual(contract)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
