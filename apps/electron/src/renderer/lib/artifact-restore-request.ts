import type { ManagedArtifact } from '@craft-agent/shared/protocol'

/** Keep the user-visible request and the exact version identity in one turn. */
export function buildArtifactRestoreRequest(record: ManagedArtifact, versionId: string): string {
  const version = record.versions.find(item => item.id === versionId)
  if (!version || versionId === record.currentVersion) throw new Error('Select a previous artifact version')
  const ordinal = version.ordinal ?? record.versions.indexOf(version) + 1
  const request = { action: 'restore', path: record.path, artifactId: record.id,
    versionId, expectedVersion: record.currentVersion }
  return `请将成果文件 ${JSON.stringify(record.path)} 恢复到第 ${ordinal} 版。使用 artifact_versions 工具，原样传入下方 JSON 的全部字段执行恢复，并报告新版本；如果文件已变化，请先说明冲突，不要覆盖。\n\n<artifact_restore_request>\n${JSON.stringify(request)}\n</artifact_restore_request>`
}
