/**
 * Follow-up sends while an Office preview is open.
 * An empty capsule is ordinary chat and may carry images and files.
 * A real element selection stays a directed edit and cannot also carry attachments.
 */

export const OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT = '已选中 Office 元素时，不能同时发送图片、文件或其他批注。请先取消选择，再附加并发送；或者去掉附件，只修改选中的内容。'

export function directedOfficeElements(selection: { elements?: readonly unknown[] } | null | undefined): number {
  if (!selection || !Array.isArray(selection.elements)) return 0
  return selection.elements.length
}

export function officeSelectionAttachmentConflict(
  selection: { elements?: readonly unknown[] } | null | undefined,
  attachmentCount: number,
  annotationCount: number,
): boolean {
  return directedOfficeElements(selection) > 0 && (attachmentCount > 0 || annotationCount > 0)
}
