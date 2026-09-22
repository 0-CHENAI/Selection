import { isAnswerTool } from './answer-delivery-guard.ts';

export interface AnswerBatchToolPart {
  id?: string
  name?: string
  type?: string
  toolCallId?: string
  toolName?: string
}

interface BatchWaiter {
  resolve(): void
  reject(error: Error): void
}

/** Wait for sibling business tools in the same SDK message before submit_answer (#361). */
export class AnswerBatchGate {
  private siblings = new Set<string>()
  private done = new Set<string>()
  private waiters = new Set<BatchWaiter>()
  private tracked = true
  private answers = 0

  begin(parts: AnswerBatchToolPart[]): void {
    this.rejectWaiters()
    this.siblings.clear()
    this.done.clear()
    this.tracked = true
    this.answers = 0
    for (const part of parts) {
      const type = part.type
      if (type && type !== 'toolCall' && type !== 'tool_use') continue
      const id = part.id || part.toolCallId
      const name = part.name || part.toolName
      if (!id || !name) {
        this.tracked = false
        continue
      }
      if (isAnswerTool(name)) this.answers++
      else this.siblings.add(id)
    }
  }

  reset(): void {
    this.siblings.clear()
    this.done.clear()
    this.tracked = true
    this.answers = 0
    this.rejectWaiters()
  }

  get answerCount(): number {
    return this.answers
  }

  get canSettleAnswer(): boolean {
    return this.tracked && this.answers === 1 && this.isSettled()
  }

  isSettled(): boolean {
    return this.done.size === this.siblings.size
  }

  markDone(toolCallId: string | undefined, toolName: string): void {
    if (!toolCallId || isAnswerTool(toolName) || !this.siblings.has(toolCallId)) return
    this.done.add(toolCallId)
    if (this.isSettled()) this.flushWaiters()
  }

  async waitForSiblings(signal?: AbortSignal): Promise<void> {
    if (!this.tracked || this.isSettled()) return
    if (signal?.aborted) throw interrupted()
    await new Promise<void>((resolve, reject) => {
      const waiter: BatchWaiter = {
        resolve: () => {
          cleanup()
          resolve()
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }
      const fail = () => waiter.reject(interrupted())
      const cleanup = () => {
        this.waiters.delete(waiter)
        signal?.removeEventListener('abort', fail)
      }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', fail, { once: true })
      if (signal?.aborted) {
        fail()
        return
      }
      if (this.isSettled()) waiter.resolve()
    })
  }

  private rejectWaiters(): void {
    this.flushWaiters(interrupted())
  }

  private flushWaiters(error?: Error): void {
    const pending = [...this.waiters]
    this.waiters.clear()
    for (const waiter of pending) {
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }
}

function interrupted(): Error {
  return new Error('Tool execution was interrupted.')
}

export function collectAnswerBatchParts(content: unknown): AnswerBatchToolPart[] {
  if (!Array.isArray(content)) return []
  return content.filter((part): part is AnswerBatchToolPart => {
    if (!part || typeof part !== 'object') return false
    const type = (part as AnswerBatchToolPart).type
    return type === 'toolCall' || type === 'tool_use'
  })
}
