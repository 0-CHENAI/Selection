export type PptCategory = '商务' | '咨询' | '学术' | '教学' | '技术' | '创意' | '社媒' | '自定义'

export interface PptTemplate {
  id: string
  title: string
  category: PptCategory
  canvas: string
  pages: number
  /** Compact bundled rendered image, safe to use in Electron and browsers. */
  cover: string
  referencePages: string[]
}

export interface PptTheme {
  id: string
  name: string
  paper: string
  ink: string
  accent: string
  signal: string
}

export interface PptCatalog {
  templates: PptTemplate[]
  themes: PptTheme[]
}

export interface PptTemplateImportResult {
  template: PptTemplate
  duplicate: boolean
}

export interface PptTemplateExport {
  name: string
  base64: string
}

export interface PptRequest {
  templateId?: string
  themeId?: string
  brandColor?: string
  logo?: { name: string; base64: string; mimeType: string }
  aspectRatio?: 'template' | '16:9' | '4:3' | '1:1' | '9:16' | 'A4' | '3:4'
}

/** deck_check outcome shown on each live thumbnail. */
export type PptPageStatus = 'passed' | 'needs_revision' | 'fixing' | 'pending'

/** Counts the history row can show without loading slide images. */
export interface PptProgress {
  fileName?: string
  total: number
  completed: number
  /** 1-based page currently being written. */
  current?: number
  currentTitle?: string
  generating: boolean
}

export interface PptLiveElement {
  id: string
  type: string
  bounds: { x: number; y: number; w: number; h: number }
  text?: string
}

export interface PptLivePage {
  /** 1-based page number. */
  index: number
  id: string
  name: string
  status: PptPageStatus
  issueCount: number
  image?: string
  imageHash?: string
  elements: PptLiveElement[]
}

export interface PptLiveSnapshot extends PptProgress {
  sessionId?: string
  canvas: { width: number; height: number; label: string }
  pptxPath?: string
  pages: PptLivePage[]
  files: Array<{ path: string; name: string }>
}

export interface PptRevisionTarget {
  /** 1-based page number. */
  page: number
  elementId?: string
}

/** Model-input only. The visible user bubble stays the comment the person typed. */
export interface PptRevision {
  action?: 'revise' | 'restyle' | 'recolor'
  targets: PptRevisionTarget[]
  templateId?: string
  themeId?: string
  comment?: string
}
