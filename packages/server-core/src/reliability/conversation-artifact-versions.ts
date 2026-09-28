import { existsSync, lstatSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { isSessionScratchPath, localArtifactLinks, localArtifactPath } from '@craft-agent/shared/utils'
import type { ArtifactDeliveryRef, Message } from '@craft-agent/core'
import { ArtifactVersions, type ArtifactRecord } from './artifact-versions'

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

/** One settled snapshot per changed file, at the conversation's delivery boundary. */
export class ConversationArtifactVersions {
  private paths = new Set<string>()
  /** Bytes observed before this turn's edits. Opening a file does not move this snapshot. */
  private baselines = new Map<string, { versionId: string; ordinal: number }>()
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
  /** Resolve the model's display choices on the host before they reach the UI. */
  async featured(paths: readonly string[]): Promise<string[]> {
    const selected = new Set<string>()
    for (const rawPath of paths) {
      const path = localArtifactPath(rawPath)
      if (!path) throw new Error(`Featured artifact is not a local path: ${rawPath}`)
      let resolved: string | undefined
      for (const candidate of isAbsolute(path) ? [path] : this.bases.map(base => resolve(base, path))) {
        try {
          const safe = await this.authorize(candidate)
          if (existsSync(safe) && lstatSync(safe).isFile() && !isSessionScratchPath(safe)) { resolved = safe; break }
        } catch { /* Another base may contain this relative path. */ }
      }
      if (!resolved) throw new Error(`Featured artifact is missing or unavailable: ${path}`)
      selected.add(resolved)
    }
    return [...selected]
  }
  async trackPath(path: string): Promise<void> {
    for (const candidate of isAbsolute(path) ? [path] : this.bases.map(base => resolve(base, path))) {
      try {
        const safe = await this.authorize(candidate)
        if (this.paths.has(safe)) return
        if (!existsSync(safe) || !lstatSync(safe).isFile()) continue
        // Before work starts, retain any externally edited baseline separately.
        let record = this.store.register(safe)
        if (!this.baselines.has(record.path)) {
          record = this.store.capture(record.id)
          const current = record.versions.find(version => version.id === record.currentVersion)!
          this.baselines.set(record.path, { versionId: current.id, ordinal: current.ordinal! })
        }
        this.paths.add(record.path)
        return
      } catch { this.onFailure() }
    }
  }
  async capture(markdown: string, sourceRunId: string, aiTitle?: string, featured: readonly string[] = []): Promise<ArtifactDeliveryRef[]> {
    const title = suppliedVersionTitle(aiTitle) ?? artifactVersionTitle(markdown)
    const deliveries = new Map<string, string>()
    // A link can cite an unchanged source file. Only add untracked files that
    // appeared during this turn; known files are compared against their baseline.
    for (const path of [...localArtifactLinks(markdown), ...featured]) {
      const candidates = isAbsolute(path) ? [path] : this.bases.map(base => join(base, path))
      for (const candidate of candidates) {
        try {
          const safe = await this.authorize(candidate)
          if (!existsSync(safe) || !lstatSync(safe).isFile()) continue
          const existing = this.store.findByPath(safe)
          if (!existing && !featured.includes(safe) && !this.writtenThisTurn(safe)) break
          const record = existing ?? this.store.register(safe, sourceRunId, [], title, title ? 'assistant' : undefined)
          this.paths.add(record.path)
          deliveries.set(record.path, featured.includes(record.path) ? record.path : path)
          break
        } catch { this.onFailure() }
      }
    }
    const result: ArtifactDeliveryRef[] = []
    for (const path of this.paths) {
      try {
        const record = this.store.findByPath(path)
        if (!record) continue
        const baseline = this.baselines.get(record.path)
        const published = deliveries.get(record.path) ?? record.path
        if (isSessionScratchPath(record.path) || isSessionScratchPath(published)) continue
        // The path was authorized when it was tracked. A deleted file can no
        // longer be canonicalized by a fresh authorization.
        if (!existsSync(path) || !lstatSync(path).isFile()) {
          if (baseline) result.push({ path: published, versionId: baseline.versionId, ordinal: baseline.ordinal, change: 'deleted' })
          continue
        }
        await this.authorize(path)
        const after = this.store.capture(record.id, sourceRunId, title, title ? 'assistant' : undefined)
        const current = after.versions.find(version => version.id === after.currentVersion)!
        if (baseline?.versionId === current.id) continue
        if (!baseline && current.sourceRunId !== sourceRunId) continue
        const change = current.restoredFrom ? 'restored' : !baseline || current.ordinal === 1 ? 'created' : 'modified'
        result.push({ path: published, versionId: current.id, ordinal: current.ordinal!, change })
      } catch { this.onFailure() }
    }
    return result
  }
}
