/** One running and at most one pending update per key. All callers await the latest update. */
export class LatestTaskQueue {
  private entries = new Map<string, { next?: () => Promise<void>; promise: Promise<void> }>()

  run(key: string, task: () => Promise<void>): Promise<void> {
    const active = this.entries.get(key)
    if (active) {
      active.next = task
      return active.promise
    }
    const entry = { next: task as (() => Promise<void>) | undefined, promise: Promise.resolve() }
    this.entries.set(key, entry)
    entry.promise = Promise.resolve().then(async () => {
      let failure: unknown
      let failed = false
      try {
        while (entry.next) {
          const next = entry.next
          entry.next = undefined
          try { await next(); failed = false } catch (error) { failure = error; failed = true }
        }
        if (failed) throw failure
      } finally { this.entries.delete(key) }
    })
    return entry.promise
  }
}
