export const OFFICE_PREVIEW_FILENAME_MAX_LENGTH = 24

/** Bound the header label while keeping the Office extension and full-name tooltip. */
export function officePreviewFileName(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? ''
  const characters = Array.from(name)
  if (characters.length <= OFFICE_PREVIEW_FILENAME_MAX_LENGTH) return name
  const extension = name.match(/\.(?:docx|xlsx|pptx)$/i)?.[0] ?? ''
  return characters.slice(0, OFFICE_PREVIEW_FILENAME_MAX_LENGTH - extension.length - 1).join('') + '…' + extension
}
