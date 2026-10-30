/**
 * Office 业务计算运行时。纪要校验、Word 案例草稿和 Excel 业务 CLI 供技能与测试调用。
 * 安装包不内置 Python，本包也不打进 electron-builder 的 files。
 */
export const OFFICE_BUSINESS_RUNTIME = {
  engine: 'bun',
  bundledPython: false,
  userFacing: true,
  installerBundle: false,
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
export { runMetricsCli } from './cli/metrics.ts'
export { runUnitEconomicsCli } from './cli/unit-economics.ts'
export { runDataQualityCli } from './cli/data-quality.ts'
export { runInfographicCli } from './cli/build-infographic.ts'
