/**
 * Office 业务计算运行时。纪要校验和 Word 案例草稿供技能与测试调用。
 * 本包仍不进入安装包，也不带 Python。
 */
export const OFFICE_BUSINESS_RUNTIME = {
  engine: 'bun',
  bundledPython: false,
  userFacing: false,
} as const

export { runQuickRatioCli, type CliResult } from './cli/quick-ratio.ts'
export { runValidateMinutesCli } from './cli/validate-minutes.ts'
export { floatNum, quickRatioJson, quickRatioText, type PyNum, type QuickRatioArgs } from './quick-ratio.ts'
export { validateMinutes, type MinutesReport } from './validate-minutes.ts'
export { evaluatePreviewChecks } from './preview-checks.ts'
export {
  draftCoffeeReport,
  draftEquityReport,
  draftGovernmentNotice,
  draftMeetingMinutes,
  loadEquityContent,
  reviewGovernmentNotice,
} from './word-drafts.ts'
