import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

/** Personal template projects and slot images (#714, #715). The host copies files and never edits the library original. */
export type PptToolName = 'ppt_template_create_project' | 'image_generate';

export const PptTemplateCreateProjectSchema = z.object({
  template_id: z.string().regex(/^custom-[a-f0-9]{16}$/).describe('Personal template id from the template library, custom- plus 16 hex characters'),
  pages: z.array(z.number().int().min(1).max(500)).max(40).optional().describe('1-based pages to copy. Omit to copy the whole project, up to 40 pages.'),
}).strict();

export const ImageGenerateSchema = z.object({
  purpose: z.enum(['presentation', 'document', 'other']).describe('presentation for a slide slot'),
  aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']),
  style_context: z.string().min(1).max(4000).describe('The six style lines verbatim, including textTreatment saying the image contains 0 text characters, plus composition'),
  prompt: z.string().min(1).max(4000).describe('Subject and composition. Do not ask for readable text inside the image.'),
  reuse_group: z.string().min(1).max(200).optional().describe('Slots with the same reuse_group share one image'),
  source_policy: z.enum(['contextual-scene', 'provided-portrait', 'native-graphic']).optional(),
}).strict();

const SCHEMAS: Record<PptToolName, z.ZodTypeAny> = {
  ppt_template_create_project: PptTemplateCreateProjectSchema,
  image_generate: ImageGenerateSchema,
};

function handler(name: PptToolName) {
  return async (ctx: SessionToolContext, args: unknown): Promise<ToolResult> => {
    const parsed = SCHEMAS[name].safeParse(args);
    if (!parsed.success) return errorResponse(`${name} 参数无效：${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('；')}`);
    if (!ctx.pptTools) return errorResponse(`${name} 在这个会话里不可用。`);
    try {
      return successResponse(JSON.stringify(await ctx.pptTools(name, parsed.data as Record<string, unknown>), null, 2));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

export const handlePptTemplateCreateProject = handler('ppt_template_create_project');
export const handleImageGenerate = handler('image_generate');

export const PPT_TEMPLATE_CREATE_DESCRIPTION = [
  '把个人模板库里的模板复制成当前工作区里的可编辑 deck.json 工程，并返回逐文件 sha256、页面清单和转换诊断。',
  '源模板不会被修改。在副本上按用户材料重写内容，不要把参考页当背景，每次最多读 12 页参考。',
  '样例页写到返回的 sampleExtensionDir，不要写回模板库。',
  '有不支持对象时告诉用户需要人工复核。连续三页同一版式只是提醒。',
  '复制之后用 deck_check，再用 office_render 看页图，禁止 OCR。',
].join('');

export const IMAGE_GENERATE_DESCRIPTION = [
  '为演示文稿的图片槽生成无文字配图。purpose 用 presentation，aspect_ratio 用槽位比例。',
  'style_context 写上全稿风格的六项原文，并写明图片内文字数量为 0。同一 reuse_group 复用，不要重复生图。',
  'contextual-scene 优先用用户图片，没有才调用本工具。provided-portrait 和 native-graphic 不要调用。',
  '没有提供方时返回占位图并说明，不要伪造图片。占位图只是提醒，不是成品。',
  '替换 src 后保持槽位边界和遮罩，再用 office_render 看主体有没有被裁切。一份稿件最多 12 次生图。',
].join('');
