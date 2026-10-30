import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PreviewCheck {
  image: string
  region: number[]
  darkMax?: number
  minInkCoverage?: number
  label?: string
}

export interface PreviewCheckFile {
  schemaVersion: number
  checks: PreviewCheck[]
}

export interface PreviewCheckResult {
  status: 'deferred'
  reason: string
  checks: number
}

/**
 * preview-checks.json 的检查项要读渲染后的页面图。
 * #705 的渲染路径尚未拍板，这里不调用 PDF 或任何渲染后端。
 */
export function evaluatePreviewChecks(caseDir: string): PreviewCheckResult {
  const file = JSON.parse(readFileSync(join(caseDir, 'preview-checks.json'), 'utf8')) as PreviewCheckFile
  if (file.schemaVersion !== 1 || !Array.isArray(file.checks) || file.checks.length === 0) {
    throw new Error('preview-checks.json 无法解析')
  }
  for (const check of file.checks) {
    if (!check.image || !Array.isArray(check.region) || check.region.length !== 4) {
      throw new Error('preview-checks.json 的检查项不完整')
    }
  }
  return {
    status: 'deferred',
    reason: '渲染路径由 #705 决定，本阶段不调用 PDF 后端，也不把缺预览当成通过。',
    checks: file.checks.length,
  }
}
