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

/** Shown on the PPT result card when an external chart skill falls back to a native chart. */
export interface PptChartFallback {
  skill: string
  reason: 'missing' | 'timeout' | 'error'
  /** 1-based page, when the failure belongs to one page. */
  page?: number
}

/** deck_check outcome shown for one page on the PPT result card. */
export type PptPageStatus = 'passed' | 'needs_revision' | 'fixing' | 'pending'

export interface PptPageProgress {
  /** 1-based page number. */
  index: number
  id: string
  name: string
  status: PptPageStatus
  issueCount: number
}

/** Counts and per-page check status. fileName is set only when a real pptx exists. */
export interface PptProgress {
  fileName?: string
  /** Absolute path of that pptx. Absent until the file is on disk. */
  pptxPath?: string
  total: number
  completed: number
  /** 1-based page currently being written. */
  current?: number
  currentTitle?: string
  generating: boolean
  pages?: PptPageProgress[]
  chartFallbacks?: PptChartFallback[]
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
