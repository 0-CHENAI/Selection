import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionJsonl, writeSessionJsonl } from '../jsonl'
import type { StoredSession } from '../types'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeSessionFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'session-usage-'))
  tempDirs.push(directory)
  return join(directory, 'session.jsonl')
}

describe('session usage accounting persistence', () => {
  it('round-trips last-call and last-turn accounting in the existing tokenUsage envelope', () => {
    const sessionFile = makeSessionFile()
    const session: StoredSession = {
      id: 'usage-session',
      workspaceRootPath: '/tmp/workspace',
      createdAt: 1,
      lastUsedAt: 2,
      messages: [],
      tokenUsage: {
        inputTokens: 300,
        outputTokens: 40,
        totalTokens: 340,
        contextTokens: 0,
        costUsd: 0.01,
        lastCall: {
          inputTokens: 200,
          outputTokens: 30,
          totalTokens: 230,
          cacheReadTokens: 150,
          cacheCreationTokens: 0,
          costUsd: 0.006,
        },
        lastTurn: {
          inputTokens: 500,
          outputTokens: 50,
          totalTokens: 550,
          cacheReadTokens: 400,
          cacheCreationTokens: 10,
          costUsd: 0.012,
          modelCallCount: 3,
          startedAt: 1_000,
          completedAt: 6_000,
          wallClockMs: 5_000,
        },
      },
    }

    writeSessionJsonl(sessionFile, session)
    expect(readSessionJsonl(sessionFile)?.tokenUsage).toEqual(session.tokenUsage)
  })

  it('does not synthesize new accounting fields for legacy headers', () => {
    const sessionFile = makeSessionFile()
    const tokenUsage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 0,
      costUsd: 0.002,
    }
    writeFileSync(sessionFile, `${JSON.stringify({
      id: 'legacy-session',
      workspaceRootPath: '/tmp/workspace',
      createdAt: 1,
      lastUsedAt: 2,
      messageCount: 0,
      tokenUsage,
    })}\n`)

    expect(readSessionJsonl(sessionFile)?.tokenUsage).toEqual(tokenUsage)
  })
})
