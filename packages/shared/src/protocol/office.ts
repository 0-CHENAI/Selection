/** Word / Excel document mode. Orthogonal to NORM / PRO. PPT stays on `PptRequest`. */

export type OfficeDocumentMode = 'word' | 'excel'

export interface OfficeRequest {
  mode: OfficeDocumentMode
  templateId?: string
  revision?: string
}

/** Host session metadata. The renderer reads it; stage 06 does not own a second copy. */
export interface OfficeDocumentState {
  mode: OfficeDocumentMode
  templateId?: string
  revision?: string
  /** Fingerprint of the injection currently represented in the transcript. */
  injectionFingerprint?: string
}

export interface OfficeTemplateSummary {
  id: string
  title: string
  mode: OfficeDocumentMode
  revision: string
  category?: string
  description?: string
  businessSkills: string[]
  source: string
  sampleFile: string
  previewCount: number
}

export interface OfficePreview {
  path: string
  available: boolean
  page?: number
}

export interface OfficeTemplatesResult {
  mode: OfficeDocumentMode | null
  templates: OfficeTemplateSummary[]
  selectedTemplateId: string | null
  selectionExpired: boolean
  preview?: OfficePreview
}

/** dsh rejects Office template bodies above 16 KB. The same bound applies here. */
export const OFFICE_REQUEST_MAX_BYTES = 16 * 1024

export const OFFICE_INJECTION_SOURCE = 'selection-office-composer'

export const OFFICE_FORMAT_UPDATED = '输出格式已按当前会话选择更新。'
