/**
 * Recursion, dedup, rate-limit, chain-spawn, and prompt-concurrency guards
 * for Agent Events. Failures are recorded as suppressed / rate-limited
 * rather than dropped silently.
 */

export const MAX_AUTOMATION_DEPTH = 3;
export const AGENT_EVENT_MATCHER_RATE_PER_MIN = 20;
export const MAX_CONCURRENT_PROMPT_AUTOMATIONS = 8;
export const AGENT_EVENT_DEDUP_TTL_MS = 5 * 60_000;
export const MAX_CHAIN_SPAWNS_PER_WINDOW = 10;
export const CHAIN_SPAWN_WINDOW_MS = 60_000;

export type AgentEventGuardReason =
  | 'duplicate'
  | 'recursion'
  | 'rate-limited'
  | 'concurrency'
  | 'chain-limit';

export class AgentEventGuards {
  private readonly seenEvents = new Map<string, number>();
  private readonly matcherWindows = new Map<string, number[]>();
  private readonly chainWindows = new Map<string, number[]>();
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

  shouldAcceptDepth(depth: number, maxDepth = MAX_AUTOMATION_DEPTH): AgentEventGuardReason | null {
    if (depth >= maxDepth) {
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

  /**
   * Sliding-window cap on automation sessions spawned from one root session.
   * Call only when a prompt session is about to be scheduled.
   */
  shouldAcceptChainSpawn(rootSessionId: string | undefined, now = Date.now()): AgentEventGuardReason | null {
    if (!rootSessionId) return null;
    const windowStart = now - CHAIN_SPAWN_WINDOW_MS;
    const timestamps = (this.chainWindows.get(rootSessionId) ?? []).filter(ts => ts > windowStart);
    if (timestamps.length >= MAX_CHAIN_SPAWNS_PER_WINDOW) {
      this.chainWindows.set(rootSessionId, timestamps);
      return 'chain-limit';
    }
    timestamps.push(now);
    this.chainWindows.set(rootSessionId, timestamps);
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
    this.chainWindows.clear();
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
