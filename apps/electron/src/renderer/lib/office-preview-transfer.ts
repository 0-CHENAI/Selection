export const OFFICE_PREVIEW_PASTE = 'selection-office-paste'
export const OFFICE_PREVIEW_PASTE_MAX_BYTES = 32 * 1024 * 1024
export const OFFICE_PREVIEW_PASTE_MAX_FILES = 20

export interface OfficePreviewRejectedFile {
  name: string
  size: number
}

function safeFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/[\u0000-\u001f]/g, '').split(/[/\\]/).pop()?.trim() ?? ''
  if (!name || name === '.' || name === '..' || name.length > 255) return undefined
  return name
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

/** Rebuild files the Office preview iframe forwarded from a user paste or drop. */
export function filesFromOfficePreviewPaste(payload: unknown): { files: File[]; rejected: OfficePreviewRejectedFile[] } {
  if (!payload || typeof payload !== 'object') return { files: [], rejected: [] }
  const record = payload as { files?: unknown; rejected?: unknown }
  const files: File[] = []
  if (Array.isArray(record.files)) {
    for (const item of record.files.slice(0, OFFICE_PREVIEW_PASTE_MAX_FILES)) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { name?: unknown; type?: unknown; buffer?: unknown }
      const name = safeFileName(entry.name)
      const bytes = asBytes(entry.buffer)
      if (!name || !bytes || bytes.byteLength === 0 || bytes.byteLength > OFFICE_PREVIEW_PASTE_MAX_BYTES) continue
      const type = typeof entry.type === 'string' && entry.type.length < 200 ? entry.type : ''
      const copy = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(copy).set(bytes)
      files.push(new File([copy], name, type ? { type } : undefined))
    }
  }
  const rejected: OfficePreviewRejectedFile[] = []
  if (Array.isArray(record.rejected)) {
    for (const item of record.rejected.slice(0, OFFICE_PREVIEW_PASTE_MAX_FILES)) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { name?: unknown; size?: unknown }
      const name = safeFileName(entry.name)
      if (!name || typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0) continue
      rejected.push({ name, size: entry.size })
    }
  }
  return { files, rejected }
}
