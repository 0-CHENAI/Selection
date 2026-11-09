/** Encoded previews only: canvases and PDF workers belong to the open dialog. */
export class PptPreviewCache {
  private values = new Map<string, string>()
  private pending = new Map<string, Promise<string>>()
  private bytes = 0
  private generation = 0

  constructor(private readonly budget = 24 * 1024 * 1024) {}

  clear() {
    this.generation++
    this.values.clear()
    this.pending.clear()
    this.bytes = 0
  }

  get(key: string, load: () => Promise<string>): Promise<string> {
    const cached = this.values.get(key)
    if (cached !== undefined) {
      this.values.delete(key)
      this.values.set(key, cached)
      return Promise.resolve(cached)
    }
    const existing = this.pending.get(key)
    if (existing) return existing
    const generation = this.generation
    const promise = Promise.resolve().then(load).then(value => {
      // Count UTF-16 storage conservatively. Oversized items can be viewed without being retained.
      const size = value.length * 2
      if (generation === this.generation && size <= this.budget) {
        while (this.bytes + size > this.budget && this.values.size) {
          const oldest = this.values.keys().next().value!
          this.bytes -= this.values.get(oldest)!.length * 2
          this.values.delete(oldest)
        }
        this.values.set(key, value)
        this.bytes += size
      }
      return value
    }).finally(() => { if (this.pending.get(key) === promise) this.pending.delete(key) })
    this.pending.set(key, promise)
    return promise
  }
}

export const pptPreviewCache = new PptPreviewCache()
