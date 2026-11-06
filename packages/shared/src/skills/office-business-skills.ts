/**
 * Bundled business skills for the Office document modes.
 * Stage 07 / 09 replace the method text. This stage only registers the entry.
 */

export const OFFICE_BUSINESS_SKILL_SLUGS = [
  'gov-doc-writing',
  'meeting-recap',
  'work-report-writer',
  'research-writer',
  'saas-metrics-coach',
  'dataset-health-audit',
  'data-viz-gen',
  'personal-contract',
  'personal-resume',
  'personal-quotation',
  'personal-budget',
  'personal-statement',
  'personal-gantt',
  'personal-application',
  'personal-invitation',
  'personal-okr',
  'personal-prd',
  'personal-letter',
] as const

export type OfficeBusinessSkillSlug = typeof OFFICE_BUSINESS_SKILL_SLUGS[number]

const SKILL_SET = new Set<string>(OFFICE_BUSINESS_SKILL_SLUGS)

export function isOfficeBusinessSkill(slug: string): slug is OfficeBusinessSkillSlug {
  return SKILL_SET.has(slug)
}

/**
 * Selection 版文件交付后缀。
 * 预览 / PDF / 重算按阶段 02 的原生优先顺序点名，不在这里调用具体宿主。
 * 计算脚本按阶段 03：TypeScript / Bun，不调用 Python。
 */
export const OFFICE_FILE_DELIVERY_SUFFIX = [
  '## 文件交付',
  '',
  '当前用户材料提供事实，所选案例提供结构和版式。不要调用 Python，不要使用 python-docx、openpyxl 或 pandas。',
  '',
  'Word 且所选案例有原生 sampleFile：用 `office_template` → 一次 `office_template_write` 填写，不要用 OfficeCLI 重建版式。交付靠宿主 7 项版式守卫和文件卡片；预览以产品内置 Office 预览为准。不要把 OfficeCLI `view screenshot` 或 `office_render` 当交付前置。写出成功且守卫通过后，不要默认截图或视觉环；仅当用户明确要求视觉验收时才做；needs_revision 只修复返回的具体错误。',
  '',
  'Word 未选案例：按精简 Word 指南自动选择样式模板。已有文件修改才走定点修改路径。Excel 使用精简 Excel 指南，保留重算与关键结果核对。默认不截图、不另起视觉模型复审。',
  '',
  '计算与校验调用会话工具 `office_business`（安装包内可用，不依赖仓库路径，也不调用 Python）。command 用 validate-minutes、metrics、quick-ratio、unit-economics、data-quality 或 infographic。本仓库里的 `packages/office-business-runtime` CLI 只用于开发对拍。不要使用 `load_workspace_dependencies`。',
  '',
  '预览与 PDF 仅在用户要求或具体显示问题需要时执行，不是默认交付前置。需要时按以下顺序，宿主未接上时说明边界，不要假装已经导出：',
  '- PDF：已安装的 OfficeCLI exporter；否则在装了 Word 的 Windows 或 macOS 上用 Word 导出；再不行用 OfficeCLI HTML 加 Electron printToPDF。测试才用 TypeScript 分页替身。',
  '- 预览（非 Word 模板路径）：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`；否则用 Electron capturePage。',
  '- 公式：OfficeCLI 把 computedValue 写回 cachedValue。仅显式启用原生 Excel 时才跑 CalculateFull。只有没求出的格子才用 TypeScript 补算。',
  '',
  'Excel 在 xlsx_recalculate 完成核对前，不要把缓存值当成已重算结果。交付文件写在工作区副本上，不覆盖案例原件和原始模板。不要用 OCR。',
].join('\n')
