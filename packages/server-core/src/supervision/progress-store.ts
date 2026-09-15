import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@craft-agent/core/types'
import type { ProgressBudget, ProgressSupervisionState, ProgressMode } from './progress-supervisor'

export interface ProgressCheckpoint {
  version: 1; taskId: string; rootId: string; mode?: ProgressMode
  state: ProgressSupervisionState; budget: ProgressBudget
  continuation?: { prompt: string; sdkSessionId?: string; userMessageId: string; consumed: boolean; candidateContext?: boolean; regenerate?: boolean; answerRunId?: string }
}
export function readProgressCheckpoint(sessionPath: string): ProgressCheckpoint | undefined {
  try {
    const data = JSON.parse(readFileSync(join(sessionPath, 'data', 'progress-supervision.json'), 'utf8'))
    if (data.version !== 1 || typeof data.taskId !== 'string' || typeof data.rootId !== 'string' || !data.state || !data.budget) return undefined
    if (![data.budget.checks, data.budget.redirects, data.budget.tokens, data.budget.reserved, data.state.checks, data.state.redirects, data.state.evaluationTokens, data.state.estimatedTokens].every(n => Number.isFinite(n) && n >= 0)) return undefined
    if (!['observing', 'evaluating', 'unavailable', 'redirecting', 'paused', 'stopped'].includes(data.state.phase)) return undefined
    if (data.continuation && (typeof data.continuation.prompt !== 'string' || typeof data.continuation.userMessageId !== 'string' || typeof data.continuation.consumed !== 'boolean')) return undefined
    return data
  } catch { /* Historical sessions have no supervision checkpoint. */ }
  return undefined
}
export function writeProgressCheckpoint(sessionPath: string, checkpoint: ProgressCheckpoint): void {
  const dir = join(sessionPath, 'data'); mkdirSync(dir, { recursive: true })
  const file = join(dir, 'progress-supervision.json')
  writeFileSync(file + '.tmp', JSON.stringify(checkpoint), 'utf8')
  renameSync(file + '.tmp', file)
}

/** Candidate UI history lives separately from the committed session. Native SDK history retains full tool results. */
export function saveProgressCandidate(sessionPath: string, messages: Message[]): void {
  const dir = join(sessionPath, 'data'); mkdirSync(dir, { recursive: true })
  const file = join(dir, 'progress-candidate.json')
  const retained = messages.map(message => message.role === 'tool'
    ? { ...message, toolResult: undefined, content: '', toolInput: undefined } : message)
  writeFileSync(file + '.tmp', JSON.stringify(retained), 'utf8'); renameSync(file + '.tmp', file)
}
export function loadProgressCandidate(sessionPath: string): Message[] {
  const messages = JSON.parse(readFileSync(join(sessionPath, 'data', 'progress-candidate.json'), 'utf8'))
  if (!Array.isArray(messages) || messages.some(m => !m || typeof m.id !== 'string' || typeof m.role !== 'string' || typeof m.content !== 'string')) throw new Error('Invalid candidate history')
  return messages
}
