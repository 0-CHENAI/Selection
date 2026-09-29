import type { ManagedArtifact } from '../protocol/artifacts'

/** A completed restore is recorded as an action, never as an instruction to an agent. */
export function buildArtifactRestoreResult(record: ManagedArtifact, versionId: string): string {
  const target = record.versions.find(version => version.id === versionId)
  if (!target || versionId === record.currentVersion) throw new Error('Select a previous artifact version')
  const current = record.versions.find(version => version.id === record.currentVersion)
  const ordinal = target.ordinal ?? record.versions.indexOf(target) + 1
  const fromOrdinal = current?.ordinal ?? (current ? record.versions.indexOf(current) + 1 : undefined)
  const result = { action: 'restore', path: record.path, artifactId: record.id,
    versionId, expectedVersion: record.currentVersion,
    ...(target.summaryOrigin === 'assistant' && target.summary ? { summary: target.summary } : {}) }
  return `已将成果文件 ${JSON.stringify(record.path)} ${fromOrdinal === undefined ? '' : `从第 ${fromOrdinal} 版`}恢复到第 ${ordinal} 版。\n\n<artifact_restore_result>\n${JSON.stringify(result)}\n</artifact_restore_result>`
}

/** Read only app-generated completed restore actions; legacy agent requests are excluded. */
export function parseArtifactRestoreResult(content: string): {
  path: string; artifactId: string; versionId: string; expectedVersion: string;
  ordinal: number; fromOrdinal?: number; summary?: string
} | null {
  const match = /^已将成果文件 ("(?:\\.|[^"\\])*") (?:从第 ([1-9]\d*) 版)?恢复到第 ([1-9]\d*) 版。\n\n<artifact_restore_result>\n(\{[^\n]+\})\n<\/artifact_restore_result>$/.exec(content)
  if (!match) return null
  try {
    const path = JSON.parse(match[1]!) as unknown
    const payload = JSON.parse(match[4]!) as Record<string, unknown>
    const allowedKeys = ['action', 'path', 'artifactId', 'versionId', 'expectedVersion', 'summary']
    if (typeof path !== 'string' || !path || !payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !allowedKeys.includes(key))
      || Object.keys(payload).length !== (payload.summary === undefined ? 5 : 6)
      || payload.action !== 'restore' || payload.path !== path
      || typeof payload.artifactId !== 'string' || !payload.artifactId
      || typeof payload.versionId !== 'string' || !payload.versionId
      || typeof payload.expectedVersion !== 'string' || !payload.expectedVersion
      || payload.summary !== undefined && (typeof payload.summary !== 'string' || !payload.summary.trim())) return null
    const ordinal = Number(match[3])
    const fromOrdinal = match[2] ? Number(match[2]) : undefined
    if (!Number.isSafeInteger(ordinal) || fromOrdinal !== undefined && !Number.isSafeInteger(fromOrdinal)) return null
    return { path, artifactId: payload.artifactId, versionId: payload.versionId,
      expectedVersion: payload.expectedVersion, ordinal,
      ...(fromOrdinal === undefined ? {} : { fromOrdinal }),
      ...(typeof payload.summary === 'string' ? { summary: payload.summary } : {}) }
  } catch { return null }
}
