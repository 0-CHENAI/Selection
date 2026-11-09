/**
 * office_render — let the model look at the pages it just generated.
 *
 * The host renders the same OfficeCLI HTML that the right-side Office preview
 * panel shows, captures the requested pages as PNG, and returns them as image
 * blocks. The model reads them natively. OCR is never part of this path.
 */

import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ImageContent, TextContent, ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export const OFFICE_RENDER_MAX_PAGES = 6;

export const OfficeRenderSchema = z.object({
  path: z.string().trim().min(1).describe('Absolute path, or a path relative to the working directory, of a .docx, .xlsx or .pptx file.'),
  pages: z.string().trim().max(200).optional().describe('Word / PowerPoint pages to render, 1-based: "1", "1,3-5", "last", "1,last" or "all". Default: all pages up to 6.'),
  sheet: z.string().trim().max(200).optional().describe('Excel only: sheet name. Default: the first sheet.'),
  range: z.string().trim().max(200).optional().describe('Excel only: cell range such as "A1:P51" or "Sheet1!A1:P51". Default: the used area from the top of the sheet.'),
}).strict();

export type OfficeRenderArgs = z.infer<typeof OfficeRenderSchema>;

export interface OfficeRenderImage {
  /** 1-based page / slide number, or the sheet name for Excel. */
  label: string;
  path: string;
  width: number;
  height: number;
  /** Base64 PNG. */
  data: string;
  truncated?: boolean;
}

export interface OfficeRenderOutcome {
  file: string;
  kind: 'docx' | 'xlsx' | 'pptx';
  renderer: string;
  /** Total pages / slides, or total sheets for Excel. */
  pageCount: number;
  sheets?: string[];
  images: OfficeRenderImage[];
  missingFonts: string[];
  notRendered?: string[];
  /** Facts about how the pages were produced, e.g. approximate page cuts. */
  notes?: string[];
  /** True when the same bytes were already open in the Office preview panel and its HTML was reused. */
  sharedWithPreviewPanel?: boolean;
}

export const OFFICE_RENDER_DESCRIPTION = [
  'Render pages of a .docx / .xlsx / .pptx you created or edited and look at them as images, to check layout, overflow, blank pages, tables, charts and fonts before delivery.',
  'Uses the same OfficeCLI HTML rendering as the Office preview panel the user sees; no external browser, LibreOffice or OCR.',
  'Word/PowerPoint: pass pages ("1,last", "2-4"). Excel: pass sheet and range. At most 6 images per call.',
  'Before delivering a generated or revised Office file, render at least its first and last page (or each changed page / key sheet area).',
  'Inspect the returned images yourself and fix what you see, then render the changed pages again. For a PowerPoint, this is the generate, render, inspect, fix loop, at most 3 rounds for the task. Never run OCR on these images. missingFonts lists fonts the document asks for that this computer does not have.',
].join(' ');

export async function handleOfficeRender(ctx: SessionToolContext, rawArgs: unknown): Promise<ToolResult> {
  const parsed = OfficeRenderSchema.safeParse(rawArgs);
  if (!parsed.success) return errorResponse(`Invalid office_render input: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
  const args = parsed.data;
  if (!/\.(docx|xlsx|pptx)$/i.test(args.path)) return errorResponse('office_render only accepts .docx, .xlsx or .pptx files.');
  if (!ctx.officeRender) {
    return errorResponse('office_render needs the Selection desktop app; it is not available in this session. Check the file structurally with officecli view text / issues instead, and do not substitute OCR.');
  }
  let outcome: OfficeRenderOutcome;
  try {
    outcome = await ctx.officeRender(args, ctx.signal);
  } catch (error) {
    return errorResponse(`office_render failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return officeRenderResult(outcome, ctx.supportsImages);
}

/** Build the tool result: one JSON text envelope, then one image block per rendered page. */
export function officeRenderResult(outcome: OfficeRenderOutcome, supportsImages: boolean | undefined): ToolResult {
  const summary = {
    file: outcome.file,
    kind: outcome.kind,
    renderer: outcome.renderer,
    pageCount: outcome.pageCount,
    ...(outcome.sheets ? { sheets: outcome.sheets } : {}),
    images: outcome.images.map(({ data: _data, ...image }) => image),
    missingFonts: outcome.missingFonts,
    ...(outcome.notRendered?.length ? { notRendered: outcome.notRendered } : {}),
    ...(outcome.sharedWithPreviewPanel ? { sharedWithPreviewPanel: true } : {}),
  };
  const notes: string[] = [...(outcome.notes ?? [])];
  if (outcome.missingFonts.length) notes.push(`Fonts not installed on this computer: ${outcome.missingFonts.join(', ')}. The pages fall back to other fonts here; tell the user, or switch to an installed font if the layout depends on it.`);
  if (outcome.notRendered?.length) notes.push(`Not rendered in this call: ${outcome.notRendered.join(', ')}. Call again with those pages if you need them.`);
  if (supportsImages === false) {
    notes.push('The current model cannot receive images, so the rendered PNG files were saved but not attached. Do not claim a visual check and do not use OCR; report that visual inspection needs an image-capable model.');
    return { content: [text(JSON.stringify(summary, null, 2) + (notes.length ? `\n\n${notes.join('\n')}` : ''))], structuredContent: summary, isError: false };
  }
  notes.push('Look at each attached image now. Check layout, overflow, clipped or overlapping text, empty pages, table borders and chart readability. Do not use OCR.');
  const content: [TextContent, ...(TextContent | ImageContent)[]] = [text(JSON.stringify(summary, null, 2) + `\n\n${notes.join('\n')}`)];
  for (const image of outcome.images) {
    content.push(text(`${outcome.kind === 'xlsx' ? 'Sheet' : outcome.kind === 'pptx' ? 'Slide' : 'Page'} ${image.label}${image.truncated ? ' (cropped to the first part; pass a range for the rest)' : ''}`));
    content.push({ type: 'image', data: image.data, mimeType: 'image/png' });
  }
  return { content, structuredContent: summary, isError: false };
}

function text(value: string): TextContent {
  return { type: 'text', text: value };
}
