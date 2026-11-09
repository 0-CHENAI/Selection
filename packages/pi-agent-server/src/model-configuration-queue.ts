/** Order model/effort mutations without blocking abort or tool-response messages. */
export class ModelConfigurationQueue {
  private pending: Promise<void> = Promise.resolve();

  enqueue(update: () => Promise<void>): Promise<void> {
    const next = this.pending.then(update);
    this.pending = next.catch(() => {});
    return next;
  }

  ready(): Promise<void> {
    return this.pending;
  }
}
