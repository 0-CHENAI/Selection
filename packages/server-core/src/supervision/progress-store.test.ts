import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProgressCheckpoint, writeProgressCheckpoint, saveProgressCandidate, loadProgressCandidate } from './progress-store'
import { createProgressBudget } from './progress-supervisor'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function root() { const path = mkdtempSync(join(tmpdir(), 'progress-store-')); roots.push(path); return path }
it('rejects corrupt and negative persisted resource counters', () => {
  const path = root(); mkdirSync(join(path, 'data'))
  writeFileSync(join(path, 'data/progress-supervision.json'), JSON.stringify({ version: 1, taskId: 'u', rootId: 's', budget: { tokens: -1 }, state: {} }))
  expect(readProgressCheckpoint(path)).toBeUndefined()
})
it('restores an unconsumed checkpoint without performing any action', () => {
  const path = root()
  writeProgressCheckpoint(path, { version: 1, taskId: 'u', rootId: 's', budget: createProgressBudget(),
    state: { phase: 'paused', checks: 1, redirects: 0, evaluationTokens: 10, estimatedTokens: 0 },
    continuation: { prompt: 'Continue from recorded results', userMessageId: 'u', sdkSessionId: 'candidate', consumed: false } })
  expect(readProgressCheckpoint(path)?.continuation?.consumed).toBe(false)
})
it('retains candidate answer identity without duplicating tool payloads', () => {
  const path = root()
  saveProgressCandidate(path, [
    { id: 'u', role: 'user', content: 'goal', timestamp: 1, answerRunId: 'candidate-answer' },
    { id: 't', role: 'tool', content: 'large result', timestamp: 2, toolResult: 'large result', toolInput: { secret: 'payload' }, toolStatus: 'completed' },
  ])
  const messages = loadProgressCandidate(path)
  expect(messages[0]?.answerRunId).toBe('candidate-answer')
  expect(messages[1]?.toolResult).toBeUndefined(); expect(messages[1]?.toolInput).toBeUndefined()
})
