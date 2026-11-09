/**
 * office_business — SaaS 指标、单位经济、数据体检、信息图和纪要结构校验。
 * 宿主在应用进程里调用 TypeScript 实现，不启动 Python，也不要求仓库路径。
 */

import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

const finite = z.number().finite();

const validateMinutes = z.object({
  command: z.literal('validate-minutes'),
  markdown: z.string().min(1).max(200_000).optional().describe('纪要 Markdown。与 path 二选一'),
  path: z.string().min(1).max(1024).optional().describe('工作区内的 .md 或 .txt'),
}).strict();

const metrics = z.object({
  command: z.literal('metrics'),
  mrr: finite,
  mrr_last: finite.optional(),
  customers: finite.optional(),
  churned: finite.optional(),
  new_customers: finite.optional(),
  sm_spend: finite.optional(),
  gross_margin: finite.optional().describe('百分数，70 表示 70%。大于 1 时按百分数换算，与原 CLI 相同'),
  expansion_mrr: finite.optional(),
  churned_mrr: finite.optional(),
  contraction_mrr: finite.optional(),
  profit_margin: finite.optional(),
  format: z.enum(['json', 'text']).optional(),
}).strict();

const quickRatio = z.object({
  command: z.literal('quick-ratio'),
  new_mrr: finite,
  churned: finite,
  expansion: finite.optional(),
  contraction: finite.optional(),
  format: z.enum(['json', 'text']).optional(),
}).strict();

const unitEconomics = z.object({
  command: z.literal('unit-economics'),
  mrr: finite,
  growth: finite.describe('月增长率百分数'),
  churn: finite.describe('月流失率百分数'),
  cac: finite.optional(),
  gross_margin: finite.optional(),
  sm_spend: finite.optional(),
  months: finite.optional(),
  format: z.enum(['json', 'text']).optional(),
}).strict();

const dataQuality = z.object({
  command: z.literal('data-quality'),
  path: z.string().min(1).max(1024).describe('工作区内的 CSV、TSV、JSON 或 XLSX'),
  sheet: z.string().min(1).max(200).optional().describe('XLSX 的工作表名，省略时用第一个工作表'),
  range: z.string().regex(/^[A-Za-z]{1,3}\d{1,7}:[A-Za-z]{1,3}\d{1,7}$/).optional().describe('XLSX 的单元格区域，如 A3:H200；首行当表头。省略时取第一行至少两个非空单元格的行作表头'),
  id_columns: z.string().max(500).optional(),
  output: z.string().min(1).max(1024).optional().describe('把报告写到工作区内的路径。省略则只返回正文'),
  sample: finite.optional().describe('抽样行数。不用 pandas 的随机种子，对拍不要依赖这个参数'),
}).strict();

const infographic = z.object({
  command: z.literal('infographic'),
  output: z.string().min(1).max(1024).describe('工作区内的 .html 输出路径'),
  config_path: z.string().min(1).max(1024).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  native_chart: z.boolean().optional(),
}).strict();

export const OfficeBusinessSchema = z.discriminatedUnion('command', [
  validateMinutes,
  metrics,
  quickRatio,
  unitEconomics,
  dataQuality,
  infographic,
]);

export type OfficeBusinessArgs = z.infer<typeof OfficeBusinessSchema>;

export const OFFICE_BUSINESS_DESCRIPTION = [
  'Run Selection office calculations inside the app: meeting-minutes structure check, SaaS metrics, Quick Ratio, unit economics, dataset health audit, and HTML infographic.',
  'Use this instead of a repository path or Python. command is validate-minutes, metrics, quick-ratio, unit-economics, data-quality, or infographic.',
  'Numeric commands default to JSON. validate-minutes checks structure only, not whether facts match the source notes.',
  'data-quality reads CSV, TSV, JSON or XLSX (cached cell values of one sheet). Paths must stay inside the workspace. Do not pass a case original as the output.',
].join(' ');

export async function handleOfficeBusiness(ctx: SessionToolContext, rawArgs: unknown): Promise<ToolResult> {
  const parsed = OfficeBusinessSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return errorResponse(`office_business 参数无效：${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('；')}`);
  }
  if (parsed.data.command === 'validate-minutes' && !parsed.data.markdown && !parsed.data.path) {
    return errorResponse('office_business validate-minutes 需要 markdown 或工作区内的 path。');
  }
  if (parsed.data.command === 'validate-minutes' && parsed.data.markdown && parsed.data.path) {
    return errorResponse('office_business validate-minutes 的 markdown 和 path 只能给一个。');
  }
  if (parsed.data.command === 'infographic' && !parsed.data.config && !parsed.data.config_path) {
    return errorResponse('office_business infographic 需要 config 或 config_path。');
  }
  if (parsed.data.command === 'infographic' && parsed.data.config && parsed.data.config_path) {
    return errorResponse('office_business infographic 的 config 和 config_path 只能给一个。');
  }
  if (!ctx.officeBusiness) return errorResponse('office_business 在这个会话里不可用。');
  try {
    return successResponse(JSON.stringify(await ctx.officeBusiness(parsed.data), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
