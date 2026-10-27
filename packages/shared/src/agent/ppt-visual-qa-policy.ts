/**
 * PowerPoint visual / layout QA must use native vision.
 *
 * The process log labels `swift` / `swiftc` as "Swift". A step such as
 * "Swift: OCR New Pages 1-4" is a Vision/tesseract script reading slide
 * screenshots. That is not a substitute for the Read tool or `call_llm`
 * image attachments. If the model cannot see images, keep the existing
 * image_capability_mismatch notice and do not fall through to OCR.
 *
 * This module reads local scripts with node:fs. Renderer code must import
 * PPT_VISUAL_QA_NO_OCR_NOTE from ./ppt-visual-qa-note.ts instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { PPT_VISUAL_QA_NO_OCR_NOTE } from './ppt-visual-qa-note.ts';

export { PPT_VISUAL_QA_NO_OCR_NOTE };

const VISUAL_QA_WORD =
  /\b(?:slides?|screenshots?|pptx|deck|cover|layout|visual|g4)\b|版式|视觉|截图|逐页|幻灯片/i;

const SLIDE_VISUAL_TARGET =
  /\.pptx\b|\bslide[-_]?\d+\b|[/\\]slides[/\\]|\bscreenshots?\b|\bpage[-_]?\d+\.(?:png|jpe?g|webp)\b|逐页|版式|幻灯片|视觉检查|visual[-_ ]review|\bG4\b/i;

const OCR_CODE =
  /VNRecognizeTextRequest|VNImageRequestHandler|\bimport\s+Vision\b|\bimport\s+pytesseract\b|\bimport\s+easyocr\b|\bfrom\s+pytesseract\b|\bfrom\s+easyocr\b|\bPaddleOCR\s*\(|pytesseract\.image_to_string|easyocr\.Reader|vision\.framework/i;

const OCR_PROGRAM = /^(?:tesseract|ocrmypdf|paddleocr|easyocr|pytesseract|pyocr|mmocr)$/i;

const SCRIPT_RUNNER = /^(?:swiftc?|python3?|node|bun|bash|sh|zsh|pwsh|powershell)$/i;

const COMMAND_WRAPPER = new Set(['sudo', 'command', 'exec', 'nice', 'nohup', 'xargs', 'env', 'time']);

const SOURCE_EXTENSION = /\.(?:swift|py|js|mjs|cjs|ts|sh|bash|zsh|ps1|command)$/i;

const DOCUMENT_EXTENSION = /\.(?:md|markdown|json|txt|csv|html|pptx|docx|xlsx)$/i;

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

export function pptVisualQaBlockReason(supportsImages?: boolean): string {
  if (supportsImages === true) {
    return [
      '当前模型可以读图（imageInput: enabled）。',
      '这一页请用 Read 打开截图，或用 call_llm 把图片放进 attachments。',
      '不要改用 OCR、Swift/Vision，也不要把步骤命名为 OCR New Pages。',
    ].join('\n');
  }
  if (supportsImages === false) {
    return [
      '当前模型不能读图（imageInput: unavailable）。',
      '按 image_capability_mismatch 说明 G4 未通过，不要假装看过这一页。',
      '不要改用 OCR、Swift/Vision 或 OCR New Pages 来代替读图。',
      PPT_VISUAL_QA_NO_OCR_NOTE,
    ].join('\n');
  }
  return [
    'PPT 页面检查跟随 <session_state> 的 imageInput。',
    'enabled：用 Read 或 call_llm 的 attachments 看截图。',
    'unavailable：报告 image_capability_mismatch，G4 不算通过。',
    '两种结果都不要改用 OCR 或名为 OCR New Pages 的步骤。',
    PPT_VISUAL_QA_NO_OCR_NOTE,
  ].join('\n');
}

export function isPptOcrStepLabel(text: string): boolean {
  const actionable = text
    .replace(/\b(?:do not|don't|never|without)\s+ocr\b/gi, '')
    .replace(/禁止(?:使用|调用)?\s*OCR/gi, '')
    .replace(/不要(?:使用|调用)?\s*OCR/gi, '');
  if (/swift\s*[:：]\s*ocr/i.test(actionable)) return true;
  if (/ocr\s+new\s+pages/i.test(actionable)) return true;
  if (/ocr\s*新页/i.test(actionable)) return true;
  return /\bocr\b/i.test(actionable) && VISUAL_QA_WORD.test(actionable);
}

function asToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.path === 'string') return record.path;
    if (typeof record.file_path === 'string') return record.file_path;
  }
  return '';
}

function commandText(input: unknown): string {
  const record = asToolInput(input);
  return [record.command, record.cmd, record.script].map(stringValue).filter(Boolean).join('\n');
}

function labelTexts(
  input: unknown,
  metadata?: { intent?: string; displayName?: string },
): string[] {
  const record = asToolInput(input);
  const labels = [
    record._displayName,
    record._intent,
    record.description,
    metadata?.displayName,
    metadata?.intent,
  ].map(stringValue).filter(text => text.length > 0 && text.length <= 400);
  const command = commandText(input);
  const comment = command.match(/^\s*(?:#|\/\/)\s*(.+)$/m)?.[1];
  if (comment) labels.push(comment);
  return labels;
}

function programName(token: string): string {
  const cleaned = token.replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
  const base = cleaned.split('/').pop() ?? cleaned;
  return base.replace(/\.(?:exe|cmd|bat)$/i, '');
}

function commandTokens(command: string): string[][] {
  return command.replace(/\\\r?\n/g, ' ').split(/\n|(?:&&|\|\||[|;])/).map(segment => {
    const tokens: string[] = [];
    for (const raw of segment.trim().split(/\s+/)) {
      if (!raw) continue;
      if (tokens.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;
      tokens.push(raw.replace(/^['"]|['"]$/g, ''));
    }
    return tokens;
  }).filter(tokens => tokens.length > 0);
}

function withoutWrappers(tokens: string[]): string[] {
  const body = [...tokens];
  while (body.length > 0) {
    const name = programName(body[0]!).toLowerCase();
    if (COMMAND_WRAPPER.has(name)) {
      body.shift();
      if (name === 'env') {
        while (body.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(body[0]!)) body.shift();
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(body[0]!)) {
      body.shift();
      continue;
    }
    break;
  }
  return body;
}

function segmentInvokesOcr(tokens: string[]): boolean {
  const body = withoutWrappers(tokens);
  if (body.length === 0) return false;
  const bin = programName(body[0]!);
  if (OCR_PROGRAM.test(bin)) return true;
  if (SCRIPT_RUNNER.test(bin)) {
    const moduleFlag = body.indexOf('-m');
    if (moduleFlag >= 0) {
      const moduleName = body[moduleFlag + 1] ?? '';
      if (/ocr|tesseract|easyocr|paddle/i.test(moduleName)) return true;
    }
    return body.slice(1).some(token => {
      const name = programName(token);
      return /ocr/i.test(name) && SOURCE_EXTENSION.test(token);
    });
  }
  return /ocr/i.test(bin);
}

function readLocalScript(token: string): string {
  if (!SOURCE_EXTENSION.test(token) || token.startsWith('-')) return '';
  try {
    if (!existsSync(token)) return '';
    const body = readFileSync(token, 'utf8');
    return body.length > 200_000 ? body.slice(0, 200_000) : body;
  } catch {
    return '';
  }
}

function executableSources(input: unknown, command: string): string {
  const record = asToolInput(input);
  const inline = OCR_CODE.test(command) ? command : '';
  const scripts = commandTokens(command).flatMap(tokens => withoutWrappers(tokens).slice(1).map(readLocalScript));
  const dest = [record.path, record.file_path, record.filePath, record.target_file].map(stringValue).find(Boolean) ?? '';
  const written = [record.contents, record.content, record.new_string, record.newString].map(stringValue).filter(Boolean).join('\n');
  const writtenCounts = written.length > 0
    && OCR_CODE.test(written)
    && SLIDE_VISUAL_TARGET.test(`${written}\n${dest}`)
    && !DOCUMENT_EXTENSION.test(dest);
  return [inline, ...scripts, writtenCounts ? written : ''].filter(Boolean).join('\n');
}

function skillTargetsSlides(toolName: string, input: unknown, labels: string[]): boolean {
  if (toolName !== 'Skill' && !/skill$/i.test(toolName)) return false;
  const record = asToolInput(input);
  const name = stringValue(record.skill ?? record.skillName ?? record.name);
  const args = stringValue(record.args);
  if (!/ocr/i.test(name)) return false;
  return isPptOcrStepLabel(name) || labels.some(isPptOcrStepLabel) || SLIDE_VISUAL_TARGET.test(`${name}\n${args}`);
}

export function pptVisualQaViolation(
  toolName: string,
  input: unknown,
  metadata?: { intent?: string; displayName?: string },
  supportsImages?: boolean,
): string | null {
  const reason = () => pptVisualQaBlockReason(supportsImages);
  const labels = labelTexts(input, metadata);
  if (labels.some(isPptOcrStepLabel)) return reason();

  const command = commandText(input);
  const sources = executableSources(input, command);
  const slideTarget = SLIDE_VISUAL_TARGET.test(`${command}\n${sources}`);
  const invokesOcr = commandTokens(command).some(segmentInvokesOcr) || OCR_CODE.test(sources);
  if (invokesOcr && slideTarget) return reason();
  if (skillTargetsSlides(toolName, input, labels)) return reason();
  return null;
}

export function assertPptVisualQaTool(
  toolName: string,
  input: unknown,
  metadata?: { intent?: string; displayName?: string },
  supportsImages?: boolean,
): void {
  const violation = pptVisualQaViolation(toolName, input, metadata, supportsImages);
  if (violation) throw new Error(violation);
}

function attachmentPaths(input: unknown): string[] {
  const raw = asToolInput(input).attachments;
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const path = (item as { path?: unknown }).path;
      return typeof path === 'string' ? path : '';
    }
    return '';
  }).filter(Boolean);
}

export function isNativeSlideVisionCall(toolName: string, input: unknown): boolean {
  if (pptVisualQaViolation(toolName, input, undefined, true)) return false;
  const record = asToolInput(input);
  const readPath = stringValue(record.path ?? record.file_path ?? record.filePath);
  if (toolName === 'Read' || toolName === 'read' || /(?:^|__)read$/i.test(toolName)) {
    return IMAGE_EXTENSION.test(readPath);
  }
  if (/(?:^|__)call_llm$/i.test(toolName) || toolName.includes('call_llm')) {
    return attachmentPaths(input).some(path => IMAGE_EXTENSION.test(path));
  }
  return false;
}

export interface PptVisualQaStep {
  toolName: string;
  input: unknown;
}

function isVisualQaWork(step: PptVisualQaStep): boolean {
  if (pptVisualQaViolation(step.toolName, step.input)) return true;
  const command = commandText(step.input);
  return /\bscreenshot\b/i.test(command) && /\.pptx\b|\bslides?\b|[/\\]slides[/\\]/i.test(command);
}

/** A screenshot or OCR attempt without a Read / image call_llm does not satisfy G4. */
export function pptVisualQaMissingNativeVision(steps: PptVisualQaStep[]): boolean {
  if (!steps.some(isVisualQaWork)) return false;
  return !steps.some(step => isNativeSlideVisionCall(step.toolName, step.input));
}
