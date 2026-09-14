/** Tracks isolated queries without retaining completed sessions. Epochs also
 * cancel requests still awaiting initialization when no session exists yet. */
export class QueryCancellation<T extends { abort(): Promise<void> }> {
  private epoch = 0;
  private sessions = new Set<T>();

  snapshot(): number { return this.epoch; }
  isActive(epoch: number): boolean { return epoch === this.epoch; }
  assertActive(epoch: number): void {
    if (!this.isActive(epoch)) throw new Error('Query cancelled');
  }
  attach(epoch: number, session: T): void {
    this.assertActive(epoch);
    this.sessions.add(session);
  }
  release(session: T): void { this.sessions.delete(session); }
  async abort(): Promise<unknown[]> {
    this.epoch++;
    const results = await Promise.allSettled([...this.sessions].map(session => Promise.resolve().then(() => session.abort())));
    return results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  }
}
