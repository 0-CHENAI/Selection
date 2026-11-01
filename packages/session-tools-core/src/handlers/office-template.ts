import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

/** Word / Excel template tools (#711). The host owns templates, selection checks and the delivery guard. */
export type OfficeToolName = 'office_template' | 'office_template_write' | 'xlsx_recalculate';

const fragment = z.object({
  source: z.string().describe('Run ID from office_template, e.g. p10:r1, whose text style this fragment keeps'),
  text: z.string(),
}).strict();

export const OfficeTemplateSchema = z.object({
  template_id: z.string().min(1).describe('The Word or Excel case ID selected in the current composer'),
}).strict();

export const OfficeTemplateWriteSchema = z.object({
  output_path: z.string().min(1).describe('A new .docx path inside the session workspace. Existing files are never overwritten.'),
  replacements: z.array(z.object({
    paragraph_id: z.string().optional().describe('Paragraph ID from editable_paragraphs, e.g. p3'),
    id: z.string().optional().describe('Alias of paragraph_id'),
    run_id: z.string().optional().describe('Replace only this run, e.g. p10:r1; other runs stay'),
    text: z.string().describe('Complete new text of the paragraph (or run). \\n starts a line break, \\t a tab.'),
    runs: z.array(fragment).optional().describe('Optional mixed typography: fragments with source run IDs that together equal text'),
  }).strict()).max(1000).describe('Replace every example fact, including the issuer header for official notices'),
  additions: z.array(z.object({
    after_paragraph_id: z.string().describe('Insert after this paragraph ID (several additions after the same ID keep their order)'),
    style_from: z.string().optional().describe('Paragraph ID whose paragraph and run styles the new paragraph clones (default: after_paragraph_id)'),
    text: z.string(),
    runs: z.array(fragment).optional(),
  }).strict()).max(1000).optional(),
  row_additions: z.array(z.object({
    after_paragraph_id: z.string().describe('Any paragraph ID inside the table row to clone; the new row goes after it'),
    cells: z.array(z.union([z.string(), z.array(z.string())])).describe('One entry per cell; an array fills the cell paragraphs in order'),
  }).strict()).max(1000).optional(),
  removals: z.array(z.union([z.string(), z.object({ paragraph_id: z.string() }).strict()])).max(1000).optional()
    .describe('Paragraph IDs with can_remove=true. Protected paragraphs (header, red line, drawings, section, table cells) are refused.'),
}).strict();

export const XlsxRecalculateSchema = z.object({
  path: z.string().min(1).describe('Workbook (.xlsx) in the session workspace; it is recalculated in place'),
  key_cells: z.array(z.string()).max(200).optional().describe('Key formula cells such as 经营总览!C8 for the dual read when the case has no checks.json'),
  visual_review: z.enum(['not-needed', 'reviewed']).describe('not-needed for pure data / formula tasks; reviewed after rendering and natively reading the affected range for format, chart or print tasks'),
  blank_page: z.boolean().optional().describe('true if the range render came back blank'),
}).strict();

const SCHEMAS: Record<OfficeToolName, z.ZodTypeAny> = {
  office_template: OfficeTemplateSchema,
  office_template_write: OfficeTemplateWriteSchema,
  xlsx_recalculate: XlsxRecalculateSchema,
};

function handler(name: OfficeToolName) {
  return async (ctx: SessionToolContext, args: unknown): Promise<ToolResult> => {
    const parsed = SCHEMAS[name].safeParse(args);
    if (!parsed.success) return errorResponse(`${name} arguments are invalid: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`);
    if (!ctx.officeTools) return errorResponse(`${name} is unavailable in this session.`);
    try {
      return successResponse(JSON.stringify(await ctx.officeTools(name, parsed.data as Record<string, unknown>), null, 2));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

export const handleOfficeTemplate = handler('office_template');
export const handleOfficeTemplateWrite = handler('office_template_write');
export const handleXlsxRecalculate = handler('xlsx_recalculate');
