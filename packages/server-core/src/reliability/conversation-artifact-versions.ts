import { existsSync, lstatSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { isSessionScratchPath, localArtifactLinks } from '@craft-agent/shared/utils'
import type { ArtifactDeliveryRef, Message } from '@craft-agent/core'
import { ArtifactVersions, sameArtifactLocation, type ArtifactRecord } from './artifact-versions'

/** Use the agent's delivered prose as the version title, never the user's request. */
export function artifactVersionTitle(markdown: string): string | undefined {
  let fenced = false
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced || !line || /^#{1,6}\s/.test(line) || /^(?:>|\|)/.test(line)) continue
    if (/^(?:交付结果|成果文件|下载|附件|文件)\s*[:：]/.test(line)) continue
    const withoutLinks = line.replace(/!?\[[^\]]*\]\([^)]+\)/g, '').replace(/[*_`\s]/g, '')
    if (withoutLinks.length < 6) continue
    const plain = line.replace(/^[-*]\s+|^\d+[.)]\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
    if (plain.length < 6) continue
    const sentenceEnd = plain.search(/[。！？!?]/u)
    const sentence = (sentenceEnd >= 0 ? plain.slice(0, sentenceEnd + 1) : plain).trim()
    const chars = Array.from(sentence)
    return chars.length <= 48 ? sentence : `${chars.slice(0, 47).join('')}…`
  }
  return undefined
}

function suppliedVersionTitle(value: string | undefined): string | undefined {
  const title = value?.trim().replace(/\s+/g, ' ').replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
  if (!title || /^(?:文件(?:内容)?(?:已)?更新|更新文件|初始版本|file (?:updated|changed)|updated file)$/i.test(title)) return undefined
  const chars = Array.from(title)
  return chars.length <= 48 ? title : `${chars.slice(0, 47).join('')}…`
}

/** Display older records using their saved AI answer without rewriting history. */
export function withHistoricalAnswerTitles(record: ArtifactRecord, answerFor: (sourceRunId: string, versionId: string) => string | undefined): ArtifactRecord {
  return { ...record, versions: record.versions.map(version => {
    if (version.summaryOrigin === 'assistant' || !version.sourceRunId) return version
    const answer = answerFor(version.sourceRunId, version.id)
    const title = answer ? artifactVersionTitle(answer) : undefined
    return title ? { ...version, summary: title, summaryOrigin: 'assistant' as const } : version
  }) }
}

/** Legacy answers may reference unchanged versions; project only versions made by that turn. */
export function withDeliveredArtifactReferences(messages: readonly Message[], sourceRunIds: ReadonlyMap<string, string | undefined>): Message[] {
  let userMessageId: string | undefined
  return messages.map(message => {
    if (message.role === 'user' && !message.hidden && !message.isQueued) userMessageId = message.id
    if (message.role !== 'assistant' || !message.artifactVersions?.length) return message
    const refs = message.artifactVersions.filter(ref =>
      !!ref.change || !!userMessageId && sourceRunIds.get(ref.versionId)?.endsWith(`/${userMessageId}`))
    return refs.length === message.artifactVersions.length ? message : { ...message, artifactVersions: refs }
  })
}

/** Add stable identities to older message references for display without changing JSONL. */
export function withArtifactIdentities(messages: readonly Message[], ids: ReadonlyMap<string, string>): Message[] {
  return messages.map(message => message.artifactVersions?.some(ref => !ref.artifactId && ids.has(ref.versionId))
    ? { ...message, artifactVersions: message.artifactVersions!.map(ref => ref.artifactId || !ids.has(ref.versionId)
      ? ref : { ...ref, artifactId: ids.get(ref.versionId)! }) }
    : message)
}

/** Keep the persistent file history intact while numbering each chat's deliveries independently. */
function numberRefs(refs: readonly ArtifactDeliveryRef[], versions: Map<string, Map<string, number>>): ArtifactDeliveryRef[] {
  return refs.map(ref => {
    const key = ref.artifactId ?? ref.path
    let seen = versions.get(key)
    if (!seen) { seen = new Map(); versions.set(key, seen) }
    if (!seen.has(ref.versionId)) seen.set(ref.versionId, seen.size + 1)
    return { ...ref, sessionOrdinal: seen.get(ref.versionId)! }
  })
}

export function numberSessionArtifactRefs(prior: readonly Message[], refs: readonly ArtifactDeliveryRef[]): ArtifactDeliveryRef[] {
  const versions = new Map<string, Map<string, number>>()
  for (const message of prior) if (message.role === 'assistant') numberRefs(message.artifactVersions ?? [], versions)
  return numberRefs(refs, versions)
}

export function withSessionArtifactOrdinals(messages: readonly Message[]): Message[] {
  const versions = new Map<string, Map<string, number>>()
  return messages.map(message => message.role === 'assistant' && message.artifactVersions?.length
    ? { ...message, artifactVersions: numberRefs(message.artifactVersions, versions) }
    : message)
}

/** A chat sees only versions it delivered; stable version IDs still address the shared snapshots. */
export function sessionArtifactRecord(record: ArtifactRecord, messages: readonly Message[]): ArtifactRecord {
  const byId = new Map(record.versions.map(version => [version.id, version]))
  const seen = new Set<string>()
  const versions = messages.flatMap(message => message.role === 'assistant' ? message.artifactVersions ?? [] : [])
    .flatMap(ref => {
      if (ref.artifactId && ref.artifactId !== record.id || seen.has(ref.versionId)) return []
      const version = byId.get(ref.versionId)
      if (!version) return []
      seen.add(ref.versionId)
      return [{ ...version, ordinal: seen.size }]
    })
  return { ...record, versions }
}

/** One settled snapshot per changed file, at the conversation's delivery boundary. */
export class ConversationArtifactVersions {
  private paths = new Set<string>()
  private pendingWrites = new Set<string>()
  /** Bytes observed before this turn's edits. Opening a file does not move this snapshot. */
  private baselines = new Map<string, { artifactId: string; versionId: string; ordinal: number }>()
  constructor(private store: ArtifactVersions, private bases: string[], private authorize: (path: string) => Promise<string>,
    private onFailure: () => void, private turnStartedAt = Date.now()) {}

  private writtenThisTurn(path: string): boolean {
    const file = statSync(path)
    // ctime also moves when a file is opened or its metadata is touched.
    // Some filesystems report a write a few milliseconds behind the process
    // clock. Keep the allowance narrow so an older linked file stays a citation.
    return Math.max(file.birthtimeMs, file.mtimeMs) >= this.turnStartedAt - 2
  }

  async track(markdown: string): Promise<void> {
    for (const path of localArtifactLinks(markdown)) await this.trackPath(path)
  }
  async trackPath(path: string): Promise<void> {
    for (const candidate of isAbsolute(path) ? [path] : this.bases.map(base => resolve(base, path))) {
      try {
        const safe = await this.authorize(candidate)
        if (this.paths.has(safe)) return
        if (!existsSync(safe)) { this.pendingWrites.add(safe); continue }
        if (!lstatSync(safe).isFile()) continue
        // Before work starts, retain any externally edited baseline separately.
        let record = this.store.register(safe)
        if (!this.baselines.has(record.path)) {
          record = this.store.capture(record.id)
          const current = record.versions.find(version => version.id === record.currentVersion)!
          this.baselines.set(record.path, { artifactId: record.id, versionId: current.id, ordinal: current.ordinal! })
        }
        this.paths.add(record.path)
        return
      } catch { this.onFailure() }
    }
  }
  async capture(markdown: string, sourceRunId: string, aiTitle?: string, changedPaths: readonly string[] = [], includeAnswerLinks = true): Promise<ArtifactDeliveryRef[]> {
    const title = suppliedVersionTitle(aiTitle) ?? artifactVersionTitle(markdown)
    const deliveries = new Map<string, string>()
    const writtenPaths = [...changedPaths, ...this.pendingWrites]
    // A link can cite an unchanged source file. Only add untracked files that
    // appeared during this turn; known files are compared against their baseline.
    for (const path of [...(includeAnswerLinks ? localArtifactLinks(markdown) : []), ...writtenPaths]) {
      const candidates = isAbsolute(path) ? [path] : this.bases.map(base => join(base, path))
      for (const candidate of candidates) {
        try {
          const safe = await this.authorize(candidate)
          if (!existsSync(safe) || !lstatSync(safe).isFile()) continue
          const existing = this.store.findByPath(safe)
          const changedPath = writtenPaths.find(path => sameArtifactLocation(path, safe))
          if (!existing && !changedPath && !this.writtenThisTurn(safe)) break
          // A file tracked before this turn can be atomically replaced by an
          // editor without becoming a new document. Untracked replacements
          // instead start their own history at the same path.
          const baseline = this.baselines.get(safe)
          const record = baseline ? this.store.read(baseline.artifactId)
            : existing ?? this.store.register(safe, sourceRunId, [], title, title ? 'assistant' : undefined)
          this.paths.add(record.path)
          deliveries.set(record.path, changedPath ?? path)
          break
        } catch { this.onFailure() }
      }
    }
    const result: ArtifactDeliveryRef[] = []
    for (const path of this.paths) {
      try {
        const tracked = this.baselines.get(path)
        const record = tracked ? this.store.read(tracked.artifactId) : this.store.findByPath(path)
        if (!record) continue
        const baseline = this.baselines.get(record.path)
        const published = deliveries.get(record.path) ?? record.path
        if (isSessionScratchPath(record.path) || isSessionScratchPath(published)) continue
        // The path was authorized when it was tracked. A deleted file can no
        // longer be canonicalized by a fresh authorization.
        if (!existsSync(path) || !lstatSync(path).isFile()) {
          if (baseline) result.push({ path: published, artifactId: record.id, versionId: baseline.versionId, ordinal: baseline.ordinal, change: 'deleted' })
          continue
        }
        await this.authorize(path)
        const after = this.store.capture(record.id, sourceRunId, title, title ? 'assistant' : undefined)
        const current = after.versions.find(version => version.id === after.currentVersion)!
        const restored = after.lastRestore?.versionId === current.id && after.lastRestore.sourceRunId === sourceRunId
        if (baseline?.versionId === current.id && !restored) continue
        if (!baseline && current.sourceRunId !== sourceRunId && !restored) continue
        const change = restored || current.restoredFrom ? 'restored' : current.ordinal === 1 ? 'created' : 'modified'
        result.push({ path: published, artifactId: record.id, versionId: current.id, ordinal: current.ordinal!, change })
      } catch { this.onFailure() }
    }
    return result
  }
}
