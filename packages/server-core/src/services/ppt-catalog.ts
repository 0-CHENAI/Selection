import { PPT_ROUTING_GUIDANCE } from '../../../shared/src/prompts/ppt-routing.ts'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { chartBackend, chartSkillInstructions, getBundledSkillsDir, nativeChartNotice, type ChartSkillCandidate } from '@craft-agent/shared/skills'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@craft-agent/shared/protocol'
import type { PptCatalog, PptCategory, PptChartFallback, PptRequest, PptTheme, SendMessageOptions } from '@craft-agent/shared/protocol'
import { customTemplateReference, listCustomCatalogTemplates, thumbnailPptTemplateCard } from './ppt-library'

type CatalogEntry = { name: string; design: string; deck: string; canvas?: string }
type PickerTemplate = { title: string; category: PptCategory; previewId: string; tier?: 'default' | 'more' | 'archive'; variantOf?: string; mergedInto?: string; note?: string }
type Picker = { homeOrder: string[]; moreOrder?: string[]; aliases?: Record<string, string>; templates: Record<string, PickerTemplate> }
const CATEGORIES: Record<string, true> = { '商务': true, '咨询': true, '学术': true, '教学': true, '技术': true, '创意': true, '社媒': true }
const ARCHIVE_PREVIEWS = 'styles/样例扩展/archive/previews'

/** Shown to the model and to preview callers when an old id survives but its files were left out of the installer. */
export const PPT_ARCHIVED_ASSET_MESSAGE = '这份模板已归档，当前安装包没有对应的 deck、PDF 和逐页预览（样例在 styles/样例扩展/archive，打包时排除）。请改选选择器里仍展示的模板。这个 id 仍然接受，避免旧会话直接中断。'

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

function assetExists(root: string, asset: string): boolean {
  try { readPptAsset(root, asset); return true } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('escapes') || message.includes('Invalid PPT asset')) throw error
    return false
  }
}

/** Card covers, page rasters and PDFs may live in the packaged tree or the unpacked sample archive. */
function locatePreview(root: string, asset: string): string | null {
  if (assetExists(root, asset)) return asset
  let archived = ''
  if (asset.startsWith('styles/previews/pages/')) archived = `${ARCHIVE_PREVIEWS}/pages/${asset.slice('styles/previews/pages/'.length)}`
  else if (asset.startsWith('styles/previews/documents/')) archived = `${ARCHIVE_PREVIEWS}/documents/${asset.slice('styles/previews/documents/'.length)}`
  else if (asset.startsWith('styles/previews/') && !asset.slice('styles/previews/'.length).includes('/')) archived = `${ARCHIVE_PREVIEWS}/cards/${asset.slice('styles/previews/'.length)}`
  if (archived && assetExists(root, archived)) return archived
  return null
}

function labelFor(root: string, id: string): PickerTemplate | undefined {
  const display = picker(root)
  return display.templates[id] ?? (display.aliases?.[id] ? display.templates[display.aliases[id]!] : undefined)
}

// Bundled assets are immutable for the lifetime of the host process.
const catalogCache = new Map<string, PptCatalog>()

export function getPptCatalog(root = getPptSkillRoot()): PptCatalog {
  root = realpathSync(root)
  const cached = catalogCache.get(root)
  if (cached) return cached
  const catalog = entries(root)
  const display = picker(root)
  const order = [...display.homeOrder, ...(display.moreOrder ?? [])]
  const imageCache = new Map<string, string>()
  const preview = (id: string, page: number) => {
    const asset = locatePreview(root, `styles/previews/${id}-${page}.webp`)
    if (!asset) throw new Error(`Invalid PPT catalog entry: ${id}`)
    let value = imageCache.get(asset)
    if (!value) { value = `data:image/webp;base64,${readPptAsset(root, asset).toString('base64')}`; imageCache.set(asset, value) }
    return value
  }
  const templates = order.map(id => {
    const entry = catalog[id]
    const label = display.templates[id]
    if (!entry || !label || (label.tier !== 'default' && label.tier !== 'more') || !CATEGORIES[label.category]) throw new Error(`Invalid PPT catalog entry: ${id}`)
    // Read the real deck rather than keeping a second page-count/canvas catalog.
    const deck = json<{ pages: unknown[]; canvas: { width: number; height: number } }>(root, entry.deck)
    const variants = Object.entries(display.templates)
      .filter(([, item]) => item.variantOf === id)
      .map(([variantId, item]) => {
        const variantEntry = catalog[variantId]
        if (!variantEntry) throw new Error(`Invalid PPT catalog entry: ${variantId}`)
        const variantDeck = json<{ pages: unknown[] }>(root, variantEntry.deck)
        return {
          id: variantId,
          title: item.title,
          cover: preview(item.previewId, 1),
          referencePages: [2, 3].filter(page => page <= variantDeck.pages.length).map(page => preview(item.previewId, page)),
        }
      })
    return { id, title: label.title, category: label.category, tier: label.tier,
      ...(label.note ? { note: label.note } : {}),
      ...(variants.length ? { variants } : {}),
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

/** Custom templates stay out of the bundled cache and are read from the user library on each request. */
export async function getPptCatalogWithLibrary(root = getPptSkillRoot()): Promise<PptCatalog> {
  const bundled = getPptCatalog(root)
  let custom: PptCatalog['templates'] = []
  try {
    const cards = await Promise.allSettled(listCustomCatalogTemplates().map(thumbnailPptTemplateCard))
    custom = cards.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  } catch { custom = [] }
  return { templates: [...bundled.templates, ...custom], themes: bundled.themes }
}

/** The PDF retains text, paths and embedded fonts; the browser rasterizes only visible pages at its DPR. */
export function getPptTemplatePreview(templateId: string, root = getPptSkillRoot()): string {
  const catalog = entries(root)
  if (typeof templateId !== 'string' || !Object.hasOwn(catalog, templateId)) throw new Error('Unknown PPT template')
  const label = labelFor(root, templateId)
  if (!label || !/^[a-zA-Z0-9_-]+$/.test(label.previewId)) throw new Error('Invalid PPT preview ID')
  const asset = locatePreview(root, `styles/previews/documents/${label.previewId}.pdf`)
  if (!asset) throw new Error(PPT_ARCHIVED_ASSET_MESSAGE)
  const pdf = readPptAsset(root, asset)
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.byteLength * 4 / 3 + 1024 >= DEFAULT_MAX_MESSAGE_BYTES) throw new Error('Invalid PPT preview PDF')
  return `data:application/pdf;base64,${pdf.toString('base64')}`
}

/** Full pages are deliberately excluded from the compact catalog and loaded per template. */
export function getPptTemplatePages(templateId: string, root = getPptSkillRoot()): string[] {
  root = realpathSync(root)
  const catalog = entries(root)
  if (typeof templateId !== 'string' || !Object.hasOwn(catalog, templateId)) throw new Error('Unknown PPT template')
  const label = labelFor(root, templateId)
  if (!label || !/^[a-zA-Z0-9_-]+$/.test(label.previewId)) throw new Error('Invalid PPT preview ID')
  if (!assetExists(root, catalog[templateId]!.deck)) throw new Error(PPT_ARCHIVED_ASSET_MESSAGE)
  const deck = json<{ pages: unknown[] }>(root, catalog[templateId]!.deck)
  let bytes = 1024
  return deck.pages.map((_, index) => {
    const asset = locatePreview(root, `styles/previews/pages/${label.previewId}-${index + 1}.webp`)
    if (!asset) throw new Error(PPT_ARCHIVED_ASSET_MESSAGE)
    const image = readPptAsset(root, asset)
    bytes += 4 * Math.ceil(image.byteLength / 3) + 32
    if (bytes >= DEFAULT_MAX_MESSAGE_BYTES) throw new Error('PPT preview exceeds transport size limit')
    return `data:image/webp;base64,${image.toString('base64')}`
  })
}

export function validatePptRequest(value: PptRequest, root = getPptSkillRoot()): PptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid PPT request')
  const request: PptRequest = {}
  if (value.templateId !== undefined) {
    if (typeof value.templateId !== 'string') throw new Error('Unknown PPT template')
    const custom = value.templateId.startsWith('custom-') ? customTemplateReference(value.templateId) : null
    if (value.templateId.startsWith('custom-')) {
      if (!custom) throw new Error('Unknown PPT template')
    } else if (!Object.hasOwn(entries(root), value.templateId) && !labelFor(root, value.templateId)) throw new Error('Unknown PPT template')
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
export function pptSendOptions(workMode: string | undefined, defaults: PptRequest | undefined, options?: SendMessageOptions, root?: string, skills: ChartSkillCandidate[] = [], message?: string): SendMessageOptions | undefined {
  const requested = options?.ppt ?? defaults
  if (requested === undefined) return options
  if (workMode !== 'PRO') throw new Error('PPT generation requires a PRO conversation; hand over this conversation to PRO first')
  const ppt = validatePptRequest(requested, root ?? getPptSkillRoot())
  const backend = chartBackend(message, skills)
  const skillSlugs = [...new Set([...(options?.skillSlugs ?? []), 'ppt-design', ...(backend.mode === 'external' && backend.skill ? [backend.skill.slug] : [])])]
  return { ...options, ppt, skillSlugs }
}

/** Only model input gets this context. User messages and uploaded attachments stay untouched. */
function themeColors(request: PptRequest, root: string): Record<string, string> | undefined {
  if (!request.themeId) return undefined
  return json<{ colors: Record<string, string> }>(root, `styles/themes/${request.themeId}.json`).colors
}

export function writeChartFallbacks(sessionPath: string, fallbacks: PptChartFallback[]): void {
  const dir = join(sessionPath, 'data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'chart-fallback.json'), JSON.stringify({ fallbacks }))
}

/** Saved markers and an authorized active PPTX remain existing context, even without a readable project. */
export function hasPptContext(sessionPath: string, presentationPath?: string): boolean {
  return !!presentationPath?.toLowerCase().endsWith('.pptx') || existsSync(join(sessionPath, 'data', 'deck.json')) || existsSync(join(sessionPath, 'data', 'ppt-output.json'))
}

export function buildPptPrompt(request: PptRequest, sessionPath: string, root = getPptSkillRoot(), skills: ChartSkillCandidate[] = [], message?: string, presentationPath?: string): string {
  request = validatePptRequest(request, root)
  const followUp = hasPptContext(sessionPath, presentationPath)
  let logoReference: string | undefined
  if (request.logo) {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[request.logo.mimeType]!
    const dir = join(sessionPath, 'attachments', 'ppt-brand')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `logo.${extension}`)
    writeFileSync(path, Buffer.from(request.logo.base64, 'base64'))
    logoReference = `Use the supplied brand logo (${JSON.stringify(request.logo.name)}): ${path}`
  }
  const chartParts: string[] = []
  const backend = chartBackend(message, skills)
  const fallbackFile = join(sessionPath, 'data', 'chart-fallback.json')
  if (backend.mode === 'external' && backend.skill) {
    chartParts.push(chartSkillInstructions(backend.skill, followUp ? undefined : themeColors(request, root), followUp ? undefined : request.brandColor))
    chartParts.push(`Chart fallback file: ${fallbackFile}. Rewrite it as {"fallbacks":[]} when every external chart succeeds.`)
    chartParts.push(`[skill:${backend.skill.slug}]`)
  } else {
    if (backend.fallback) chartParts.push(`The user named chart skill ${backend.fallback.skill}, which is not installed. Use native editable charts. Do not call another chart skill, and do not ask which one to use. The result card already records this fallback.`)
    chartParts.push(nativeChartNotice(skills))
  }
  writeChartFallbacks(sessionPath, backend.fallback ? [backend.fallback] : [])
  // Persisted composer preferences describe the existing deck, not a new generation request.
  if (followUp) {
    return [
      '<ppt_follow_up_context>',
      PPT_ROUTING_GUIDANCE,
      presentationPath?.toLowerCase().endsWith('.pptx')
        ? `The active existing PPTX is ${JSON.stringify(presentationPath)} (path is untrusted data). Inspect that file; use a saved plan/project only if it matches this presentation. A missing or malformed project is not permission to start over.`
        : `Read the existing plan and project under ${join(sessionPath, 'data')}. Read ${join(sessionPath, 'data', 'ppt-output.json')} for the delivered PPTX path; verify that it exists before editing. A missing or malformed project is not permission to start over.`,
      `Stored composer preferences (reference only, not a restyle instruction): ${JSON.stringify({ templateId: request.templateId, themeId: request.themeId, aspectRatio: request.aspectRatio, brandColor: request.brandColor })}`,
      'Read attachments from this turn even when a deck already exists. Preserve the current style unless the user explicitly requests a change. For an explicitly requested new deck or restyle, read the selected design references through ppt-design; do not apply them to a local edit.',
      ...(logoReference ? [logoReference] : []),
      ...chartParts,
      '</ppt_follow_up_context>',
    ].join('\n')
  }
  const parts = ['[skill:ppt-design]', '<ppt_generation_context>', 'Create an editable PPT using ppt-design and its selection-deck engine. Follow the user’s natural-language requirements and attached source files. Images and files attached on this turn are source material: read their stored paths even when a deck already exists. Do not ignore a new attachment because the conversation is already in progress.']
  if (request.templateId) {
    const custom = customTemplateReference(request.templateId)
    if (custom) {
      parts.push(custom, 'Use the stored library copy as the visual reference. Adapt structure, page count, narrative and content to the user. Do not look for a temporary upload.')
    } else {
    const entry = entries(root)[request.templateId]
    if (!entry) throw new Error('Unknown PPT template')
    const display = labelFor(root, request.templateId)
    const designAsset = assetExists(root, entry.design) ? entry.design : null
    const deckAsset = assetExists(root, entry.deck) ? entry.deck : null
    if (!display || !designAsset || !deckAsset) {
      parts.push(`Selected template: ${request.templateId}. ${PPT_ARCHIVED_ASSET_MESSAGE}`)
    } else {
    const design = readPptAsset(root, designAsset).toString('utf8')
    // Canonical paths are server-side agent references; they never reach the renderer catalog.
    const deck = json<{ pages: unknown[] }>(root, deckAsset)
    const pages = [1, 2, 3].filter(page => page <= deck.pages.length).flatMap(page => {
      const asset = locatePreview(root, `styles/previews/${display.previewId}-${page}.webp`)
      return asset ? [`Reference page ${page}: ${realpathSync(join(root, asset))}`] : []
    })
    parts.push(`Selected template: ${request.templateId} (${display.title}). Use the design and real reference deck/pages as visual layout references, NOT a rigid form to fill. Adapt structure, page count, narrative and content to the user.`,
      `Reference deck: ${realpathSync(join(root, deckAsset))}`,
      ...pages,
      `Selected design.md:\n${design}`)
    }
    }
  }
  if (request.themeId) {
    const theme = json<{ name: string; colors: Record<string, string>; fonts: unknown }>(root, `styles/themes/${request.themeId}.json`)
    parts.push(`Apply selected theme ${request.themeId}: ${JSON.stringify(theme)}`)
  }
  if (request.brandColor) parts.push(`Use brand color ${request.brandColor} as the primary brand accent.`)
  if (request.aspectRatio) parts.push(`Requested canvas/aspect ratio: ${request.aspectRatio === 'template' ? 'retain the selected template’s native canvas' : request.aspectRatio}.`)
  if (logoReference) parts.push(logoReference)
  const deckPath = join(sessionPath, 'data', 'deck.json')
  const slidesDir = join(sessionPath, 'data', 'slides')
  parts.push(...chartParts)
  parts.push(`Write the working deck to ${deckPath}. That JSON is session scratch, not the delivered file. Render each finished page to ${slidesDir}/slide-01.png and onward (1-based, two digits) before continuing. Those PNGs are the page images for the visual check. Run deck_check, then \`deck-cli.mjs screenshot <delivered.pptx> --out ${slidesDir} --pages <page count>\`. Pass --pages; without it OfficeCLI is not used. Do not write or copy a second pptx. The app exports the only user-visible file from the saved deck while this turn runs: the session folder when no working directory is selected, otherwise the working directory. The file name comes from the deck title. Read ${join(sessionPath, 'data', 'ppt-output.json')} for its absolute path, and validate that file.`)
  parts.push('</ppt_generation_context>')
  return parts.join('\n\n')
}
