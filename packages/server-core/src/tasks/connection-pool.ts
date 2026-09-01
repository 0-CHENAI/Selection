/**
 * Workspace-level concurrency pool keyed by LLM connection.
 * A run's max_parallel is still the local ceiling; this pool only tightens it.
 */
export class LlmConnectionPool {
  private readonly inFlight = new Map<string, number>();
  private readonly waiters: Array<{ connection: string; resolve: () => void }> = [];

  constructor(private readonly defaultLimit = 4) {}

  inUse(connection: string): number {
    return this.inFlight.get(this.key(connection)) ?? 0;
  }

  tryAcquire(connection: string, limit = this.defaultLimit): boolean {
    const key = this.key(connection);
    const used = this.inFlight.get(key) ?? 0;
    const cap = Math.max(1, limit);
    if (used >= cap) return false;
    this.inFlight.set(key, used + 1);
    return true;
  }

  release(connection: string): void {
    const key = this.key(connection);
    const used = this.inFlight.get(key) ?? 0;
    if (used <= 1) this.inFlight.delete(key);
    else this.inFlight.set(key, used - 1);
    const idx = this.waiters.findIndex((waiter) => waiter.connection === key);
    if (idx >= 0) {
      const [waiter] = this.waiters.splice(idx, 1);
      waiter?.resolve();
    }
  }

  waitFor(connection: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ connection: this.key(connection), resolve });
    });
  }

  private key(connection: string): string {
    return connection.trim() || 'default';
  }
}
