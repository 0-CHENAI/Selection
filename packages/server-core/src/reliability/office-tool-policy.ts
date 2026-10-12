/** Interactive revisions use the embedded preview, never browser-based rendering. */
export function assertOfficeRevisionTool(toolName: string, input: Record<string, unknown>): void {
  if (/browser|playwright|puppeteer|selenium/i.test(toolName)) {
    throw new Error('Office 协同修改禁止调用外部浏览器，请使用内置预览和文件结构检查。')
  }
  if (!/^(bash|shell|exec|exec_command)$/i.test(toolName)) return
  const command = String(input.command ?? input.cmd ?? '').replace(/\\\r?\n/g, ' ')
  if ((/officecli/i.test(command) && /\b(?:screenshot|render)\b/i.test(command))
    || /(?:^|[\s/"'])(?:google chrome|chrome|chromium|msedge|firefox|playwright|puppeteer|selenium)(?:\.app|[\s"']|$)/i.test(command)
    || /\b(?:open|xdg-open|start)\s+(?:-[a-z]+\s+)*(?:["']?(?:https?:|file:)|-a\b)/i.test(command)) {
    throw new Error('Office 协同修改不允许截图渲染或启动外部浏览器；请使用 officecli get/view text、validate 和内置实时预览。命令未执行。')
  }
}
