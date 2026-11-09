/**
 * Host record of the PPT authoring route.
 * A mismatch tells the model to change the route. It is not a session failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PPT_ROUTES = ['office_edit', 'deck_revision', 'restyle', 'import_rebuild'] as const
export type PptAuthoringRoute = (typeof PPT_ROUTES)[number]

const ROUTE_LINE = /(?:^|\n)\s*(?:路由|route)\s*[:：]\s*(office_edit|deck_revision|restyle|import_rebuild)\b/i

export function readPptRoute(sessionDir: string): PptAuthoringRoute | undefined {
  const files = [join(sessionDir, 'data', 'ppt-route.json'), join(sessionDir, 'data', 'design-plan.md'), join(sessionDir, 'design-plan.md')]
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(text) as { route?: unknown }
        if (typeof parsed.route === 'string' && (PPT_ROUTES as readonly string[]).includes(parsed.route)) return parsed.route as PptAuthoringRoute
        continue
      }
      const match = text.match(ROUTE_LINE)
      if (match?.[1] && (PPT_ROUTES as readonly string[]).includes(match[1])) return match[1] as PptAuthoringRoute
    } catch { /* An unreadable plan does not invent a route. */ }
  }
  return undefined
}

function commandOf(input: Record<string, unknown>): string {
  return String(input.command ?? input.cmd ?? '')
}

/** Remind the model when a whole-deck tool disagrees with the recorded route. */
export function pptRouteMismatch(sessionDir: string, toolName: string, input: Record<string, unknown> = {}): string | undefined {
  const route = readPptRoute(sessionDir)
  if (route !== 'office_edit') return undefined
  const name = toolName.replace(/^(?:mcp__session__|session__)/, '')
  const command = commandOf(input)
  const importsDeck = name === 'ppt_template_create_project' || (/\bdeck-cli(?:\.mjs)?\b/.test(command) && /\bimport\b/.test(command))
  if (!importsDeck) return undefined
  return '路由提醒：当前记录的路由是定点修改（office_edit）。复制模板工程或导入重建会整套重写，和这个路由不一致。请先把 design-plan 里的路由改成 import_rebuild、deck_revision 或 restyle，或只做定点修改。这不是失败。'
}
