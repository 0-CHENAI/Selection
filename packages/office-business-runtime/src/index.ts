/**
 * 内部运行时。LinNai 确认 docs/adr/office-python-features-in-ts.md 之前，
 * 不注册为技能、不进入安装包、不对用户可见。
 */
export const OFFICE_BUSINESS_RUNTIME = {
  engine: 'bun',
  bundledPython: false,
  userFacing: false,
} as const

export { runQuickRatioCli, type CliResult } from './cli/quick-ratio.ts'
export { floatNum, quickRatioJson, quickRatioText, type PyNum, type QuickRatioArgs } from './quick-ratio.ts'
