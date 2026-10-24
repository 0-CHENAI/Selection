import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getBundledSkillsDir } from '@craft-agent/shared/skills'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@craft-agent/shared/protocol'
import type { PptCatalog, PptCategory, PptRequest, PptTheme, SendMessageOptions } from '@craft-agent/shared/protocol'

type CatalogEntry = { name: string; design: string; deck: string; canvas?: string }
type Picker = { homeOrder: string[]; templates: Record<string, { title: string; category: PptCategory; previewId: string }> }
const CATEGORIES: Record<string, true> = { '商务': true, '咨询': true, '学术': true, '教学': true, '技术': true, '创意': true, '社媒': true }

/** Check the canonical path, not just its spelling: symlinks may leave the bundled root. */
export function readPptAsset(root: string, asset: string): Buffer {
  if (isAbsolute(asset)) throw new Error('Invalid PPT asset path')
  const canonicalRoot = realpathSync(root)
  const path = realpathSync(resolve(canonicalRoot, asset))
  const within = relative(canonicalRoot, path)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('PPT asset escapes bundled root')
  return readFileSync(path)
}

export function getPptSkillRoot(): string {
  const skills = getBundledSkillsDir()
  if (!skills) throw new Error('Bundled PPT skill is unavailable')
  return realpathSync(join(skills, 'ppt-design'))
}

function json<T>(root: string, asset: string): T {
  return JSON.parse(readPptAsset(root, asset).toString('utf8')) as T
}
function entries(root: string): Record<string, CatalogEntry> { return json(root, 'styles/catalog.json') }
function picker(root: string): Picker { return json(root, 'styles/picker.json') }

// Bundled assets are immutable for the lifetime of the host process.
const catalogCache = new Map<string, PptCatalog>()

export function getPptCatalog(root = getPptSkillRoot()): PptCatalog {
  root = realpathSync(root)
  const cached = catalogCache.get(root)
  if (cached) return cached
  const catalog = entries(root)
  const display = picker(root)
  const order = [...display.homeOrder, ...Object.keys(catalog).filter(id => !display.homeOrder.includes(id))]
  const imageCache = new Map<string, string>()
  const preview = (id: string, page: number) => {
    const asset = `styles/previews/${id}-${page}.webp`
    let value = imageCache.get(asset)
    if (!value) { value = `data:image/webp;base64,${readPptAsset(root, asset).toString('base64')}`; imageCache.set(asset, value) }
    return value
  }
  const templates = order.map(id => {
    const entry = catalog[id]
    const label = display.templates[id]
    if (!entry || !label || !CATEGORIES[label.category]) throw new Error(`Invalid PPT catalog entry: ${id}`)
    // Read the real deck rather than keeping a second page-count/canvas catalog.
    const deck = json<{ pages: unknown[]; canvas: { width: number; height: number } }>(root, entry.deck)
    return { id, title: label.title, category: label.category,
      canvas: entry.canvas ?? (deck.canvas.width / deck.canvas.height === 16 / 9 ? '16:9' : `${deck.canvas.width}×${deck.canvas.height}`),
      pages: deck.pages.length, cover: preview(label.previewId, 1),
      referencePages: [2, 3].filter(page => page <= deck.pages.length).map(page => preview(label.previewId, page)) }
  })
  const themes = Object.keys(json<Record<string, unknown>>(root, 'styles/themes/catalog.json')).map(id => {
    const theme = json<{ name: string; colors: Omit<PptTheme, 'id' | 'name'> }>(root, `styles/themes/${id}.json`)
    const { paper, ink, accent, signal } = theme.colors
    return { id, name: theme.name, paper, ink, accent, signal }
  })
  const result = { templates, themes }
  catalogCache.set(root, result)
  return result
}

/** Full pages are deliberately excluded from the compact catalog and loaded per template. */
export function getPptTemplatePages(templateId: string, root = getPptSkillRoot()): string[] {
  root = realpathSync(root)
  const catalog = entries(root)
  if (typeof templateId !== 'string' || !Object.hasOwn(catalog, templateId)) throw new Error('Unknown PPT template')
  const label = picker(root).templates[templateId]
  if (!label || !/^[a-zA-Z0-9_-]+$/.test(label.previewId)) throw new Error('Invalid PPT preview ID')
  const deck = json<{ pages: unknown[] }>(root, catalog[templateId]!.deck)
  let bytes = 1024
  return deck.pages.map((_, index) => {
    const image = readPptAsset(root, `styles/previews/pages/${label.previewId}-${index + 1}.webp`)
    bytes += 4 * Math.ceil(image.byteLength / 3) + 32
    if (bytes >= DEFAULT_MAX_MESSAGE_BYTES) throw new Error('PPT preview exceeds transport size limit')
    return `data:image/webp;base64,${image.toString('base64')}`
  })
}

export function validatePptRequest(value: PptRequest, root = getPptSkillRoot()): PptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid PPT request')
  const request: PptRequest = {}
  if (value.templateId !== undefined) {
    if (typeof value.templateId !== 'string' || !Object.hasOwn(entries(root), value.templateId)) throw new Error('Unknown PPT template')
    request.templateId = value.templateId
  }
  if (value.themeId !== undefined) {
    if (typeof value.themeId !== 'string' || !Object.hasOwn(json<Record<string, unknown>>(root, 'styles/themes/catalog.json'), value.themeId)) throw new Error('Unknown PPT theme')
    request.themeId = value.themeId
  }
  if (value.brandColor !== undefined) {
    if (typeof value.brandColor !== 'string' || !/^#[\da-f]{6}$/i.test(value.brandColor)) throw new Error('Invalid PPT brand color')
    request.brandColor = value.brandColor
  }
  if (value.aspectRatio !== undefined) {
    if (!['template', '16:9', '4:3', '1:1', '9:16', 'A4', '3:4'].includes(value.aspectRatio)) throw new Error('Invalid PPT aspect ratio')
    request.aspectRatio = value.aspectRatio
  }
  if (value.logo !== undefined) {
    const logo = value.logo
    if (!logo || typeof logo.name !== 'string' || logo.name.length > 255 || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(logo.mimeType)
      || typeof logo.base64 !== 'string' || logo.base64.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(logo.base64)) throw new Error('Invalid PPT logo')
    request.logo = { name: logo.name, base64: logo.base64, mimeType: logo.mimeType }
  }
  return request
}

/** The host never silently upgrades an established ordinary conversation; use the existing handover. */
export function pptSendOptions(workMode: string | undefined, defaults: PptRequest | undefined, options?: SendMessageOptions, root?: string): SendMessageOptions | undefined {
  const requested = options?.ppt ?? defaults
  if (requested === undefined) return options
  if (workMode !== 'PRO') throw new Error('PPT generation requires a PRO conversation; hand over this conversation to PRO first')
  return { ...options, ppt: validatePptRequest(requested, root ?? getPptSkillRoot()), skillSlugs: [...new Set([...(options?.skillSlugs ?? []), 'ppt-design'])] }
}

/** Only model input gets this context. User messages and uploaded attachments stay untouched. */
export function buildPptPrompt(request: PptRequest, sessionPath: string, root = getPptSkillRoot()): string {
  request = validatePptRequest(request, root)
  const parts = ['[skill:ppt-design]', '<ppt_generation_context>', 'Create an editable PPT using ppt-design and its selection-deck engine. Follow the user’s natural-language requirements and attached source files.']
  if (request.templateId) {
    const entry = entries(root)[request.templateId]
    if (!entry) throw new Error('Unknown PPT template')
    const display = picker(root).templates[request.templateId]!
    const design = readPptAsset(root, entry.design).toString('utf8')
    // Canonical paths are server-side agent references; they never reach the renderer catalog.
    const deck = json<{ pages: unknown[] }>(root, entry.deck)
    parts.push(`Selected template: ${request.templateId} (${display.title}). Use the design and real reference deck/pages as visual layout references, NOT a rigid form to fill. Adapt structure, page count, narrative and content to the user.`,
      `Reference deck: ${realpathSync(join(root, entry.deck))}`,
      ...[1, 2, 3].filter(page => page <= deck.pages.length).map(page => {
        const asset = `styles/previews/${display.previewId}-${page}.webp`
        readPptAsset(root, asset)
        return `Reference page ${page}: ${realpathSync(join(root, asset))}`
      }),
      `Selected design.md:\n${design}`)
  }
  if (request.themeId) {
    const theme = json<{ name: string; colors: Record<string, string>; fonts: unknown }>(root, `styles/themes/${request.themeId}.json`)
    parts.push(`Apply selected theme ${request.themeId}: ${JSON.stringify(theme)}`)
  }
  if (request.brandColor) parts.push(`Use brand color ${request.brandColor} as the primary brand accent.`)
  if (request.aspectRatio) parts.push(`Requested canvas/aspect ratio: ${request.aspectRatio === 'template' ? 'retain the selected template’s native canvas' : request.aspectRatio}.`)
  if (request.logo) {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[request.logo.mimeType]!
    const dir = join(sessionPath, 'attachments', 'ppt-brand')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `logo.${extension}`)
    writeFileSync(path, Buffer.from(request.logo.base64, 'base64'))
    parts.push(`Use the supplied brand logo (${JSON.stringify(request.logo.name)}): ${path}`)
  }
  const deckPath = join(sessionPath, 'data', 'deck.json')
  const slidesDir = join(sessionPath, 'data', 'slides')
  parts.push(`Write the working deck to ${deckPath}. Render each finished page to ${slidesDir}/slide-01.png and onward (1-based, two digits) before continuing, so the live panel can show it. Run deck_check and deck_render into those paths.`)
  parts.push('</ppt_generation_context>')
  return parts.join('\n\n')
}
