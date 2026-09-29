import { describe, expect, it } from 'bun:test'
import { parseArtifactRestoreDisplay } from '../artifact-restore-display'
import { getUserMessageCopyText } from '../visible-user-message-text'
import { buildArtifactRestoreResult } from '@craft-agent/shared/utils/artifact-restore-message'
import type { ManagedArtifact } from '@craft-agent/shared/protocol'

function restoreMessage(path: string, ordinal = 1, fromOrdinal?: number, historical = false): string {
  const payload = { action: 'restore', path, artifactId: 'artifact', versionId: 'v1', expectedVersion: 'v2' }
  return `请将成果文件 ${JSON.stringify(path)} ${fromOrdinal === undefined ? '' : `从第 ${fromOrdinal} 版`}恢复到第 ${ordinal} 版。使用 artifact_versions 工具，原样传入下方 JSON 的全部字段执行恢复，并报告${historical ? '新' : '当前'}版本；如果文件已变化，请先说明冲突，不要覆盖。\n\n<artifact_restore_request>\n${JSON.stringify(payload)}\n</artifact_restore_request>`
}

describe('artifact restore message display', () => {
  it('shows the restored version summary at the bottom of the completed action card', () => {
    const record = { id: 'artifact', path: '/workspace/hello.docx', currentVersion: 'v2', versions: [
      { id: 'v1', ordinal: 1, summary: '生成仅含 hello 的 Word 文档', summaryOrigin: 'assistant' },
      { id: 'v2', ordinal: 2 },
    ] } as ManagedArtifact
    const message = buildArtifactRestoreResult(record, 'v1')
    expect(parseArtifactRestoreDisplay(message)).toEqual({ path: record.path, fileName: 'hello.docx',
      fromOrdinal: 2, ordinal: 1, summary: '生成仅含 hello 的 Word 文档' })
    expect(getUserMessageCopyText(message)).toContain('生成仅含 hello 的 Word 文档')
  })

  it('summarizes a generated restore request and copies only readable text', () => {
    const message = restoreMessage('/Volumes/LOFY_EX/openhanako/hello.docx', 1, 2)
    expect(parseArtifactRestoreDisplay(message)).toEqual({
      path: '/Volumes/LOFY_EX/openhanako/hello.docx', fileName: 'hello.docx', ordinal: 1, fromOrdinal: 2,
    })
    expect(getUserMessageCopyText(message)).toBe('恢复文件 /Volumes/LOFY_EX/openhanako/hello.docx：第 2 版 → 第 1 版')
  })

  it('keeps historical restore requests readable without inventing a source version', () => {
    const message = restoreMessage('/workspace/report.docx', 1, undefined, true)
    expect(parseArtifactRestoreDisplay(message)).toEqual({
      path: '/workspace/report.docx', fileName: 'report.docx', ordinal: 1,
    })
    expect(getUserMessageCopyText(message)).toBe('恢复文件 /workspace/report.docx 至第 1 版')
  })

  it('keeps altered or malformed requests as ordinary message text', () => {
    const message = restoreMessage('/workspace/report.docx')
    expect(parseArtifactRestoreDisplay(`备注\n${message}`)).toBeNull()
    expect(parseArtifactRestoreDisplay(message.replace('"artifactId":"artifact"', '"artifactId":null'))).toBeNull()
    expect(parseArtifactRestoreDisplay(message.replace('"path":"/workspace/report.docx"', '"path":"/workspace/other.docx"'))).toBeNull()
    expect(parseArtifactRestoreDisplay(message.replace('"expectedVersion":"v2"', '"expectedVersion":"v2","note":"keep visible"'))).toBeNull()
    expect(parseArtifactRestoreDisplay(message.replace('第 1 版', '第 0 版'))).toBeNull()
  })
})
