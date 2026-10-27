/** Files from a paste or drop. Screenshots often live on `items`, not `files`. */
export interface ClipboardFileSource {
  files?: ArrayLike<File> | null
  items?: ArrayLike<{ kind: string; getAsFile?: () => File | null }> | null
}

export function clipboardHasFiles(data: ClipboardFileSource | null | undefined): boolean {
  if (!data) return false
  if (data.files && Array.from(data.files).some(file => file.size > 0)) return true
  if (!data.items) return false
  return Array.from(data.items).some(item => item.kind === 'file')
}

export function clipboardFiles(data: ClipboardFileSource | null | undefined): File[] {
  if (!data) return []
  const direct = data.files ? Array.from(data.files).filter(file => file.size > 0) : []
  if (direct.length > 0) return direct
  if (!data.items) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile?.()
    if (file && file.size > 0) files.push(file)
  }
  return files
}
