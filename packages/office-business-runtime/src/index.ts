/**
 * Office 业务计算运行时。阶段 09 起供技能调用。
 * 安装包不内置 Python，本包也不打进 electron-builder 的 files。
 */
export const OFFICE_BUSINESS_RUNTIME = {
  engine: 'bun',
  bundledPython: false,
  userFacing: true,
  installerBundle: false,
} as const

export { runQuickRatioCli } from './cli/quick-ratio.ts'
export type { CliResult } from './cli/quick-ratio.ts'
export { floatNum, quickRatioJson, quickRatioText, type PyNum, type QuickRatioArgs } from './quick-ratio.ts'
export { runMetricsCli } from './cli/metrics.ts'
export { runUnitEconomicsCli } from './cli/unit-economics.ts'
export { runDataQualityCli } from './cli/data-quality.ts'
export { runInfographicCli } from './cli/build-infographic.ts'
