import { randomInt } from 'node:crypto'
import type { PlatformType } from './types'

export interface PairingEntry {
  workspaceId: string
  sessionId: string
  platform: PlatformType
  code: string
  expiresAt: number
}

export interface GeneratedPairing {
  code: string
  expiresAt: number
}

export const PAIRING_TTL_MS = 5 * 60 * 1000
export const PAIRING_RATE_LIMIT_PER_MINUTE = 10
export const PAIR_CONSUME_RATE_PER_MINUTE = 5

interface Bucket {
  windowStart: number
  count: number
}

export class PairingCodeManager {
  private readonly entries = new Map<string, PairingEntry>()
  private readonly buckets = new Map<string, Bucket>()
  private readonly consumeBuckets = new Map<string, Bucket>()

  constructor(
    private readonly ttlMs: number = PAIRING_TTL_MS,
    private readonly ratePerMinute: number = PAIRING_RATE_LIMIT_PER_MINUTE,
    private readonly consumeRatePerMinute: number = PAIR_CONSUME_RATE_PER_MINUTE,
  ) {}

  generate(workspaceId: string, sessionId: string, platform: PlatformType): GeneratedPairing {
    this.checkRate(workspaceId)
    this.gc()
    let code = this.randomCode()
    for (let i = 0; i < 5 && this.entries.has(this.key(platform, code)); i++) {
      code = this.randomCode()
    }
    const expiresAt = Date.now() + this.ttlMs
    this.entries.set(this.key(platform, code), {
      workspaceId,
      sessionId,
      platform,
      code,
      expiresAt,
    })
    return { code, expiresAt }
  }

  consume(workspaceId: string, platform: PlatformType, code: string): PairingEntry | null {
    const key = this.key(platform, code)
    const entry = this.entries.get(key)
    if (!entry || entry.workspaceId !== workspaceId) return null
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key)
      return null
    }
    this.entries.delete(key)
    return entry
  }

  clearWorkspace(workspaceId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.workspaceId === workspaceId) this.entries.delete(key)
    }
  }

  canConsume(workspaceId: string, platform: PlatformType, senderId: string): boolean {
    const key = `${workspaceId}:${platform}:${senderId}`
    const now = Date.now()
    const bucket = this.consumeBuckets.get(key)
    if (!bucket || now - bucket.windowStart > 60_000) {
      this.consumeBuckets.set(key, { windowStart: now, count: 1 })
      return true
    }
    if (bucket.count >= this.consumeRatePerMinute) return false
    bucket.count += 1
    return true
  }

  private key(platform: PlatformType, code: string): string {
    return `${platform}:${code}`
  }

  private randomCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }

  private checkRate(workspaceId: string): void {
    const now = Date.now()
    const bucket = this.buckets.get(workspaceId)
    if (!bucket || now - bucket.windowStart > 60_000) {
      this.buckets.set(workspaceId, { windowStart: now, count: 1 })
      return
    }
    if (bucket.count >= this.ratePerMinute) {
      const error = new Error('Pairing code rate limit exceeded')
      ;(error as Error & { code?: string }).code = 'RATE_LIMIT'
      throw error
    }
    bucket.count += 1
  }

  private gc(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(key)
    }
  }
}
