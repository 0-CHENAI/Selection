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
  '当前用户材料提供事实，所选案例提供结构和版式。制作 Word 时配合 OfficeCLI 的 officecli-docx（命令 `officecli load_skill word`），制作 Excel 时配合 officecli-xlsx（命令 `officecli load_skill excel`）。不要调用 Python，不要使用 python-docx、openpyxl 或 pandas。',
  '',
  '计算与校验调用会话工具 `office_business`（安装包内可用，不依赖仓库路径，也不调用 Python）。command 用 validate-minutes、metrics、quick-ratio、unit-economics、data-quality 或 infographic。本仓库里的 `packages/office-business-runtime` CLI 只用于开发对拍。不要使用 `load_workspace_dependencies`。',
  '',
  '预览、PDF 和公式重算按阶段 02 已定的原生优先顺序选择步骤，宿主未接上时说明边界，不要假装已经导出：',
  '- PDF：已安装的 OfficeCLI exporter；否则在装了 Word 的 Windows 或 macOS 上用 Word 导出；再不行用 OfficeCLI HTML 加 Electron printToPDF。测试才用 TypeScript 分页替身。',
  '- 预览：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`；否则用 Electron capturePage。',
  '- 公式：OfficeCLI 把 computedValue 写回 cachedValue。探测到 Excel 时再跑 CalculateFull 复核。只有没求出的格子才用 TypeScript 补算。',
  '',
  'Excel 在 xlsx_recalculate 完成核对前，不要把缓存值当成已重算结果。交付文件写在工作区副本上，不覆盖案例原件和原始模板。不要用 OCR。',
].join('\n')
