import { parseArtifactRestoreResult } from '@craft-agent/shared/utils/artifact-restore-message'

/** Present app-generated restore requests without exposing their tool payload in chat. */
export function parseArtifactRestoreDisplay(content: string): { path: string; fileName: string; ordinal: number; fromOrdinal?: number; summary?: string } | null {
  const restored = parseArtifactRestoreResult(content)
  if (restored) return { path: restored.path, fileName: restored.path.split(/[\\/]/).pop() || restored.path,
    ordinal: restored.ordinal, ...(restored.fromOrdinal === undefined ? {} : { fromOrdinal: restored.fromOrdinal }),
    ...(restored.summary ? { summary: restored.summary } : {}) }
  const match = /^请将成果文件 ("(?:\\.|[^"\\])*") (?:从第 ([1-9]\d*) 版)?恢复到第 ([1-9]\d*) 版。使用 artifact_versions 工具，原样传入下方 JSON 的全部字段执行恢复，并报告(?:新|当前)版本；如果文件已变化，请先说明冲突，不要覆盖。\n\n<artifact_restore_request>\n(\{[^\n]+\})\n<\/artifact_restore_request>$/.exec(content)
  if (!match) return null

  try {
    const path = JSON.parse(match[1]!) as unknown
    const payload = JSON.parse(match[4]!) as Record<string, unknown>
    const allowedKeys = ['action', 'path', 'artifactId', 'versionId', 'expectedVersion', 'summary']
    if (typeof path !== 'string' || !path || Object.keys(payload).some(key => !allowedKeys.includes(key))
      || Object.keys(payload).length !== (payload.summary === undefined ? 5 : 6)
      || payload.action !== 'restore' || payload.path !== path
      || typeof payload.artifactId !== 'string' || !payload.artifactId
      || typeof payload.versionId !== 'string' || !payload.versionId
      || typeof payload.expectedVersion !== 'string' || !payload.expectedVersion
      || payload.summary !== undefined && (typeof payload.summary !== 'string' || !payload.summary.trim())) return null

    const ordinal = Number(match[3])
    const fromOrdinal = match[2] ? Number(match[2]) : undefined
    if (!Number.isSafeInteger(ordinal) || fromOrdinal !== undefined && !Number.isSafeInteger(fromOrdinal)) return null
    return { path, fileName: path.split(/[\\/]/).pop() || path, ordinal,
      ...(fromOrdinal === undefined ? {} : { fromOrdinal }),
      ...(typeof payload.summary === 'string' ? { summary: payload.summary } : {}) }
  } catch {
    return null
  }
}
