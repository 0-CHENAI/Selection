import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cn } from '@/lib/utils'

const REPO_ROOT = resolve(import.meta.dir, '../../../../../../..')

function readRepoFile(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

function collectTsxFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'playground') continue
      results.push(...collectTsxFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
      results.push(full)
    }
  }
  return results
}

/**
 * Matches JSX className attributes containing standalone Tailwind `grid` paired
 * with `gap-*` (layout grids, not icon/overlay stacking grids like `grid size-3.5`
 * or `grid place-items-center`) that omit an explicit column track definition.
 *
 * Without `grid-cols-*` (or CSS `grid-template-columns`), CSS Grid creates an
 * implicit `auto` column track whose minimum size expands to untruncated
 * `white-space: nowrap` descendants, causing modals, cards, and sidebars to
 * overflow horizontally even when children use `min-w-0 flex-1 truncate`.
 */
const EXPLICIT_GRID_COLUMNS_RE = /\b(?:(?:[a-z0-9-]+:)?grid-cols-|grid-flow-col|auto-cols-|task-workbench-grid|task-editor-authoring)/
const IMPLICIT_LAYOUT_GRID_RE = /\bgrid\b/
const LAYOUT_GAP_RE = /\bgap(?:-[xy])?-/

function extractClassNameExpressions(source: string): Array<{ index: number; literals: string }> {
  const results: Array<{ index: number; literals: string }> = []
  const markerRe = /\bclassName\s*=\s*/g
  let match: RegExpExecArray | null

  while ((match = markerRe.exec(source)) !== null) {
    const start = match.index + match[0].length
    const quote = source[start]
    if (quote === '"' || quote === "'") {
      let i = start + 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 2
        else i += 1
      }
      results.push({ index: match.index, literals: source.slice(start + 1, i) })
    } else if (quote === '{') {
      let depth = 1
      let i = start + 1
      let inStr: string | null = null
      while (i < source.length && depth > 0) {
        const ch = source[i]
        if (inStr) {
          if (ch === '\\') { i += 2; continue }
          if (ch === inStr) inStr = null
        } else {
          if (ch === '"' || ch === "'" || ch === '`') inStr = ch
          else if (ch === '{') depth += 1
          else if (ch === '}') depth -= 1
        }
        i += 1
      }
      const expr = source.slice(start + 1, i - 1)
      const literals = [...expr.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map(m => m[2]).join(' ')
      results.push({ index: match.index, literals })
    }
  }

  return results
}

function findImplicitColumnLayoutGrids(source: string): Array<{ line: number; snippet: string }> {
  const violations: Array<{ line: number; snippet: string }> = []

  for (const { index, literals } of extractClassNameExpressions(source)) {
    if (!IMPLICIT_LAYOUT_GRID_RE.test(literals)) continue
    if (!LAYOUT_GAP_RE.test(literals)) continue
    if (EXPLICIT_GRID_COLUMNS_RE.test(literals)) continue

    const line = source.slice(0, index).split('\n').length
    violations.push({
      line,
      snippet: literals.replace(/\s+/g, ' ').trim().slice(0, 140),
    })
  }

  return violations
}

/**
 * Finds `<DialogContent>` usages that pass an unprefixed `max-w-*` class (e.g. `max-w-lg`)
 * which overrides `DialogContent`'s viewport-clamping `max-w-[calc(100%-2rem)]` on narrow screens.
 * Callers should use responsive `sm:max-w-*` or explicit viewport clamps like `max-w-[min(...,calc(100%-2rem))]`.
 */
function findUnclampedDialogMaxWidths(source: string): Array<{ line: number; snippet: string }> {
  const violations: Array<{ line: number; snippet: string }> = []
  const tagRe = /<DialogContent\b[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(source)) !== null) {
    const tag = match[0]
    for (const { literals } of extractClassNameExpressions(tag)) {
      const tokens = literals.split(/\s+/).filter(Boolean)
      const offending = tokens.filter(token =>
        /^max-w-/.test(token)
        && token !== 'max-w-none'
        && !token.includes('100%')
        && !token.includes('100vw')
        && !token.includes('100dvw'),
      )
      if (offending.length > 0) {
        const line = source.slice(0, match.index).split('\n').length
        violations.push({ line, snippet: offending.join(' ') })
      }
    }
  }

  return violations
}

describe('project-wide overflow containment guardrails', () => {
  it('sets overflow-wrap: break-word in global stylesheets', () => {
    const electronCss = readRepoFile('apps/electron/src/renderer/index.css')
    const sharedUiCss = readRepoFile('packages/ui/src/styles/index.css')

    expect(electronCss).toContain('overflow-wrap: break-word;')
    expect(electronCss).toContain('overflow-wrap: anywhere !important;')
    expect(sharedUiCss).toContain('overflow-wrap: break-word;')
  })

  it('hardens Dialog, Popover, Drawer, and Tooltip primitives against horizontal overflow', () => {
    const dialog = readRepoFile('apps/electron/src/renderer/components/ui/dialog.tsx')
    const popover = readRepoFile('apps/electron/src/renderer/components/ui/popover.tsx')
    const drawer = readRepoFile('packages/ui/src/components/ui/drawer.tsx')
    const tooltip = readRepoFile('packages/ui/src/components/tooltip.tsx')

    expect(dialog).toContain('grid grid-cols-1 [&>*]:min-w-0')
    expect(dialog).toContain('overflow-x-clip')
    expect(dialog).toContain('min-w-0 break-words text-lg')
    expect(dialog).toContain('min-w-0 break-words text-muted-foreground')

    expect(popover).toContain('max-w-[calc(100vw-2rem)]')
    expect(popover).toContain('overflow-x-clip')
    expect(popover).toContain('[&>*]:min-w-0')

    expect(drawer).toContain('overflow-x-clip')
    expect(drawer).toContain('[&>*]:min-w-0')

    expect(tooltip).toContain('max-w-[calc(100vw-2rem)]')
    expect(tooltip).toContain('break-words')

    // Ensure EditPopover's `overflow-visible` cleanly overrides PopoverContent's `overflow-x-clip`
    expect(cn('overflow-x-clip', 'overflow-visible')).toBe('overflow-visible')
  })

  it('hardens form inputs, selects, commands, floating menus, list rows, and markdown containers', () => {
    const input = readRepoFile('apps/electron/src/renderer/components/ui/input.tsx')
    const textarea = readRepoFile('apps/electron/src/renderer/components/ui/textarea.tsx')
    const select = readRepoFile('apps/electron/src/renderer/components/ui/select.tsx')
    const command = readRepoFile('apps/electron/src/renderer/components/ui/command.tsx')
    const dropdown = readRepoFile('apps/electron/src/renderer/components/ui/dropdown-menu.tsx')
    const contextMenu = readRepoFile('apps/electron/src/renderer/components/ui/context-menu.tsx')
    const styledDropdown = readRepoFile('packages/ui/src/components/ui/StyledDropdown.tsx')
    const simpleDropdown = readRepoFile('packages/ui/src/components/ui/SimpleDropdown.tsx')
    const entityRow = readRepoFile('apps/electron/src/renderer/components/ui/entity-row.tsx')
    const markdown = readRepoFile('packages/ui/src/components/markdown/Markdown.tsx')
    const codeBlock = readRepoFile('packages/ui/src/components/markdown/CodeBlock.tsx')

    expect(input).toContain('min-w-0')
    expect(textarea).toContain('min-w-0 max-w-full')
    expect(select).toContain('[&>span]:min-w-0 [&>span]:truncate')
    expect(select).not.toContain('[&>span]:line-clamp-1')
    expect(select).toContain('max-w-[calc(100vw-2rem)]')
    expect(select).toContain('size-4 shrink-0 opacity-50')
    expect(command).toContain('min-w-0')
    expect(command).toContain('ml-auto shrink-0')

    expect(dropdown).toContain('max-w-[calc(100vw-1rem)]')
    expect(contextMenu).toContain('max-w-[calc(100vw-1rem)]')
    expect(styledDropdown).toContain('max-w-[calc(100vw-1rem)]')
    expect(simpleDropdown).toContain('max-w-[calc(100vw-1rem)]')

    expect(entityRow).toContain('line-clamp-2 min-w-0 break-words')
    expect(entityRow).toContain('min-w-0 flex-1 line-clamp-2 break-words')

    expect(markdown).toContain('markdown-content min-w-0 max-w-full break-words')
    expect(codeBlock).toContain('font-mono text-[13px] break-words')
  })

  it('static detectors accurately catch violations and permit safe patterns', () => {
    expect(findImplicitColumnLayoutGrids('<div className="grid gap-2" />')).toHaveLength(1)
    expect(findImplicitColumnLayoutGrids('<div className={cn("grid gap-1", active && "p-2")} />')).toHaveLength(1)
    expect(findImplicitColumnLayoutGrids('<div className={`grid gap-2 ${extra}`} />')).toHaveLength(1)
    expect(findImplicitColumnLayoutGrids('<div className="grid grid-cols-1 gap-2" />')).toEqual([])
    expect(findImplicitColumnLayoutGrids('<span className="grid size-4 place-items-center" />')).toEqual([])

    expect(findUnclampedDialogMaxWidths('<DialogContent className="max-w-lg" />')).toHaveLength(1)
    expect(findUnclampedDialogMaxWidths('<DialogContent className="sm:max-w-lg" />')).toEqual([])
    expect(findUnclampedDialogMaxWidths('<DialogContent className="max-w-[min(560px,calc(100%-2rem))]" />')).toEqual([])
  })

  it('forbids implicit-column layout grids and unclamped DialogContent max-w overrides across renderer and @craft-agent/ui', () => {
    const roots = [
      join(REPO_ROOT, 'apps/electron/src/renderer'),
      join(REPO_ROOT, 'packages/ui/src'),
    ]

    const gridViolations: string[] = []
    const dialogViolations: string[] = []
    for (const root of roots) {
      for (const file of collectTsxFiles(root)) {
        const source = readFileSync(file, 'utf8')
        const rel = relative(REPO_ROOT, file)
        for (const v of findImplicitColumnLayoutGrids(source)) {
          gridViolations.push(`${rel}:${v.line} -> "${v.snippet}"`)
        }
        for (const v of findUnclampedDialogMaxWidths(source)) {
          dialogViolations.push(`${rel}:${v.line} -> "${v.snippet}"`)
        }
      }
    }

    expect(gridViolations).toEqual([])
    expect(dialogViolations).toEqual([])
  })
})
