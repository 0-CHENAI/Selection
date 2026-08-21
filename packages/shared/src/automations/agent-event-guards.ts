/**
 * Recursion, dedup, rate-limit, and prompt-concurrency guards for Agent Events.
 * Failures are recorded as suppressed / rate-limited rather than dropped silently.
 */

export const MAX_AUTOMATION_DEPTH = 1;
export const AGENT_EVENT_MATCHER_RATE_PER_MIN = 20;
export const MAX_CONCURRENT_PROMPT_AUTOMATIONS = 8;
export const AGENT_EVENT_DEDUP_TTL_MS = 5 * 60_000;

export type AgentEventGuardReason =
  | 'duplicate'
  | 'recursion'
  | 'rate-limited'
  | 'concurrency';

export class AgentEventGuards {
  private readonly seenEvents = new Map<string, number>();
  private readonly matcherWindows = new Map<string, number[]>();
  private inflightPrompts = 0;

  shouldAcceptEvent(eventId: string, now = Date.now()): AgentEventGuardReason | null {
    this.pruneSeen(now);
    const previous = this.seenEvents.get(eventId);
    if (previous != null && now - previous < AGENT_EVENT_DEDUP_TTL_MS) {
      return 'duplicate';
    }
    this.seenEvents.set(eventId, now);
    return null;
  }

  shouldAcceptDepth(triggeredByAutomation: boolean, depth: number): AgentEventGuardReason | null {
    if (triggeredByAutomation || depth >= MAX_AUTOMATION_DEPTH) {
      return 'recursion';
    }
    return null;
  }

  shouldAcceptMatcher(workspaceId: string, event: string, matcherId: string, now = Date.now()): AgentEventGuardReason | null {
    const key = `${workspaceId}:${event}:${matcherId}`;
    const windowStart = now - 60_000;
    const timestamps = (this.matcherWindows.get(key) ?? []).filter(ts => ts > windowStart);
    if (timestamps.length >= AGENT_EVENT_MATCHER_RATE_PER_MIN) {
      this.matcherWindows.set(key, timestamps);
      return 'rate-limited';
    }
    timestamps.push(now);
    this.matcherWindows.set(key, timestamps);
    return null;
  }

  tryAcquirePromptSlot(): boolean {
    if (this.inflightPrompts >= MAX_CONCURRENT_PROMPT_AUTOMATIONS) {
      return false;
    }
    this.inflightPrompts += 1;
    return true;
  }

  releasePromptSlot(): void {
    this.inflightPrompts = Math.max(0, this.inflightPrompts - 1);
  }

  dispose(): void {
    this.seenEvents.clear();
    this.matcherWindows.clear();
    this.inflightPrompts = 0;
  }

  private pruneSeen(now: number): void {
    if (this.seenEvents.size < 200) return;
    for (const [id, ts] of this.seenEvents) {
      if (now - ts > AGENT_EVENT_DEDUP_TTL_MS) {
        this.seenEvents.delete(id);
      }
    }
  }
}
