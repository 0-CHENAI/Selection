export type PptCategory = '商务' | '咨询' | '学术' | '教学' | '技术' | '创意' | '社媒'

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

export interface PptRequest {
  templateId?: string
  themeId?: string
  brandColor?: string
  logo?: { name: string; base64: string; mimeType: string }
  aspectRatio?: 'template' | '16:9' | '4:3' | '1:1' | '9:16' | 'A4' | '3:4'
}
