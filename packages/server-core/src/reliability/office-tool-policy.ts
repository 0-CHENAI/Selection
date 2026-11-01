/**
 * Interactive revisions use the embedded preview, never browser-based rendering.
 *
 * office_render is the one sanctioned way for the model to see pages: the host
 * renders the same OfficeCLI HTML as the Office preview panel offscreen and
 * hands the PNGs to native image input. Bare officecli screenshot / render,
 * external browsers and OCR stay blocked.
 */
const OFFICE_RENDER_TOOL = /^(?:mcp__session__|session__)?office_render$/
const OCR_COMMAND = /(?:^|[\s/"'`;|&(])(?:tesseract|ocrmypdf|paddleocr|easyocr|pytesseract|pyocr|mmocr)(?:\.exe)?(?=[\s"'`;|&)]|$)|\bimport\s+(?:pytesseract|easyocr)\b|\bfrom\s+(?:pytesseract|easyocr|paddleocr)\b|VNRecognizeTextRequest|-m\s+(?:pytesseract|easyocr|paddleocr)\b/i

export function isOfficeRenderTool(toolName: string): boolean {
  return OFFICE_RENDER_TOOL.test(toolName)
}

export function assertOfficeRevisionTool(toolName: string, input: Record<string, unknown>): void {
  if (isOfficeRenderTool(toolName)) return
  if (/browser|playwright|puppeteer|selenium/i.test(toolName)) {
    throw new Error('Office 协同修改禁止调用外部浏览器，请使用内置预览和 office_render 页图。')
  }
  if (!/^(bash|shell|exec|exec_command)$/i.test(toolName)) return
  const command = String(input.command ?? input.cmd ?? '').replace(/\\\r?\n/g, ' ')
  if (OCR_COMMAND.test(command)) {
    throw new Error('Office 页面检查禁止 OCR。请调用 office_render 取页图，直接看图判断。命令未执行。')
  }
  if ((/officecli/i.test(command) && /\b(?:screenshot|render)\b/i.test(command))
    || /(?:^|[\s/"'])(?:google chrome|chrome|chromium|msedge|firefox|playwright|puppeteer|selenium)(?:\.app|[\s"']|$)/i.test(command)
    || /\b(?:open|xdg-open|start)\s+(?:-[a-z]+\s+)*(?:["']?(?:https?:|file:)|-a\b)/i.test(command)) {
    throw new Error('Office 协同修改不允许用 officecli 截图或启动外部浏览器；要看页面请调用 office_render，结构检查用 officecli get/view text、validate。命令未执行。')
  }
}
