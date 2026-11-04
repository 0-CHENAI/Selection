import { classifyFile, type FilePreviewType } from './file-classification'

export type FileOpenRoute =
  | { kind: 'external' }
  | { kind: 'html' }
  | { kind: 'preview'; type: FilePreviewType }

export function isHeicFilePath(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  return /\.hei[cf]$/i.test(base)
}

/**
 * Decide in-app preview vs the system opener.
 * HEIC/HEIF stay classified as images so a successful JPEG transcode can
 * preview; if that transcode fails, fall back to the old open-externally path.
 */
export async function resolveFileOpenRoute(
  path: string,
  canLoadImagePreview: (path: string) => Promise<boolean>,
): Promise<FileOpenRoute> {
  const classification = classifyFile(path)
  if (!classification.canPreview || !classification.type) return { kind: 'external' }
  if (classification.type === 'html') return { kind: 'html' }
  if (classification.type === 'image' && isHeicFilePath(path)) {
    try {
      return (await canLoadImagePreview(path))
        ? { kind: 'preview', type: 'image' }
        : { kind: 'external' }
    } catch {
      return { kind: 'external' }
    }
  }
  return { kind: 'preview', type: classification.type }
}
