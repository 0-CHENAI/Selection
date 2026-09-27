import { existsSync, lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { localArtifactLinks } from '@craft-agent/shared/utils'
import { ArtifactVersions } from './artifact-versions'

/** One settled snapshot per changed file, at the conversation's delivery boundary. */
export class ConversationArtifactVersions {
  private paths = new Set<string>()
  constructor(private store: ArtifactVersions, private bases: string[], private authorize: (path: string) => Promise<string>,
    private onFailure: () => void) {}

  async track(markdown: string): Promise<void> {
    for (const path of localArtifactLinks(markdown)) await this.trackPath(path)
  }
  async trackPath(path: string): Promise<void> {
    for (const candidate of isAbsolute(path) ? [path] : this.bases.map(base => resolve(base, path))) {
      try {
        const safe = await this.authorize(candidate)
        if (this.paths.has(safe)) return
        if (!existsSync(safe) || !lstatSync(safe).isFile()) continue
        // Before work starts, retain any externally edited baseline separately.
        const record = this.store.register(safe)
        if (!this.paths.has(record.path)) this.store.capture(record.id)
        this.paths.add(record.path)
        return
      } catch { this.onFailure() }
    }
  }
  async capture(markdown: string, sourceRunId: string, summary: string): Promise<Array<{ path: string; versionId: string; ordinal: number }>> {
    const message = summary.trim().split(/\r?\n/)[0]?.slice(0, 160)
    const deliveries = new Map<string, string>()
    // New deliverables start at v1; already tracked files are captured below.
    for (const path of localArtifactLinks(markdown)) {
      const candidates = isAbsolute(path) ? [path] : this.bases.map(base => join(base, path))
      for (const candidate of candidates) {
        try {
          const safe = await this.authorize(candidate)
          if (!existsSync(safe) || !lstatSync(safe).isFile()) continue
          const record = this.store.register(safe, sourceRunId, [], message)
          this.paths.add(record.path)
          deliveries.set(record.path, path)
          break
        } catch { this.onFailure() }
      }
    }
    const result = []
    for (const path of this.paths) {
      try {
        await this.authorize(path)
        const record = this.store.findByPath(path)
        if (!record) continue
        const after = this.store.capture(record.id, sourceRunId, message)
        const current = after.versions.find(version => version.id === after.currentVersion)!
        result.push({ path: deliveries.get(after.path) ?? after.path, versionId: current.id, ordinal: current.ordinal! })
      } catch { this.onFailure() }
    }
    return result
  }
}
