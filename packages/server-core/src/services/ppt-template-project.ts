/**
 * Copy a personal template project into a workspace directory.
 * The library original is read, hashed, and never written.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getPptSkillRoot } from './ppt-catalog.ts'
import { materializeTemplateProject, pptTemplateLibraryRoot, type TemplateProjectDiagnostics } from './ppt-library.ts'

export interface TemplateTaskPage {
  index: number
  id: string
  layout: string
  name?: string
}

export interface TemplateTaskFile {
  path: string
  sha256: string
}

export interface TemplateTaskProject {
  projectDir: string
  sourceSha256: string
  sourceUnchanged: true
  pages: TemplateTaskPage[]
  diagnostics: TemplateProjectDiagnostics
  files: TemplateTaskFile[]
  sampleExtensionDir: string
  proposedImageSlots?: string
  review: boolean
}

function sha256(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!!rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function filesIn(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...filesIn(path))
    else found.push(path)
  }
  return found.sort()
}

function copyFileRecord(from: string, to: string): TemplateTaskFile {
  const bytes = readFileSync(from)
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, bytes)
  return { path: to, sha256: sha256(bytes) }
}

export function writeSampleExtension(projectDir: string, fileName: string, bytes: Uint8Array): string {
  if (!fileName || fileName !== fileName.trim() || /[\\/]|\.\./.test(fileName)) throw new Error('样例扩展文件名无效')
  const dir = join(projectDir, 'sample-extension')
  mkdirSync(dir, { recursive: true })
  const target = resolve(dir, fileName)
  if (!within(dir, target)) throw new Error('样例扩展不能写到工程外面')
  writeFileSync(target, bytes)
  return target
}

export async function createTemplateTaskProject(options: {
  templateId: string
  workspaceDir: string
  pages?: number[]
  libraryRoot?: string
}): Promise<TemplateTaskProject> {
  const libraryRoot = options.libraryRoot ?? pptTemplateLibraryRoot()
  const workspaceDir = resolve(options.workspaceDir)
  if (within(libraryRoot, workspaceDir) || within(workspaceDir, libraryRoot)) throw new Error('任务工程不能写进模板库，也不能包住模板库')
  const record = await materializeTemplateProject(options.templateId, libraryRoot)
  const sourcePath = existsSync(join(libraryRoot, record.id, 'source.pptx'))
    ? join(libraryRoot, record.id, 'source.pptx')
    : join(libraryRoot, record.id, 'deck.json')
  const before = sha256(readFileSync(sourcePath))
  const stored = join(libraryRoot, record.id, 'project')
  if (!existsSync(join(stored, 'deck.json'))) throw new Error('模板工程还没生成。有不支持的对象时，它仍只作为参考。')
  const projectDir = join(workspaceDir, `template-${record.id}`)
  mkdirSync(projectDir, { recursive: true })
  const files = filesIn(stored).map(file => copyFileRecord(file, join(projectDir, relative(stored, file))))
  const deckPath = join(projectDir, 'deck.json')
  const deck = JSON.parse(readFileSync(deckPath, 'utf8')) as { pages?: Array<{ id?: string; layout?: string; name?: string; elements?: Array<{ id?: string; type?: string; chartImage?: unknown; bounds?: { w?: number; h?: number }; alt?: string }> }> }
  const wanted = options.pages?.filter(page => Number.isInteger(page) && page >= 1)
  if (wanted && wanted.length) {
    const keep = new Set(wanted)
    deck.pages = (deck.pages ?? []).filter((_, index) => keep.has(index + 1))
    writeFileSync(deckPath, `${JSON.stringify(deck, null, 2)}\n`)
    const listed = files.find(file => file.path === deckPath)
    if (listed) listed.sha256 = sha256(readFileSync(deckPath))
  }
  const after = sha256(readFileSync(sourcePath))
  if (after !== before || after !== record.sha256 && record.sourceKind === 'pptx') {
    throw new Error('模板原件哈希变了，已停止复制')
  }
  const pages: TemplateTaskPage[] = (deck.pages ?? []).map((page, index) => ({
    index: index + 1,
    id: typeof page.id === 'string' && page.id ? page.id : `page-${index + 1}`,
    layout: typeof page.layout === 'string' ? page.layout : 'free',
    ...(typeof page.name === 'string' && page.name ? { name: page.name } : {}),
  }))
  const proposed = await proposeOnCopy(deckPath, deck.pages ?? [])
  const diagnostics = record.diagnostics ?? { faithful: pages.length, approximate: 0, retained: 0, unsupported: 0 }
  return {
    projectDir,
    sourceSha256: after,
    sourceUnchanged: true,
    pages,
    diagnostics,
    files,
    sampleExtensionDir: join(projectDir, 'sample-extension'),
    ...(proposed ? { proposedImageSlots: proposed } : {}),
    review: diagnostics.unsupported > 0,
  }
}

async function proposeOnCopy(deckPath: string, pages: Array<{ id?: string; elements?: Array<{ type?: string; chartImage?: unknown }> }>): Promise<string | undefined> {
  if (!pages.some(page => page.elements?.some(element => element.type === 'image' && !element.chartImage))) return undefined
  const { proposeImageContract } = await import(pathToFileURL(join(getPptSkillRoot(), 'engine/image-slots.ts')).href) as {
    proposeImageContract: (page: unknown) => unknown
  }
  const deck = JSON.parse(readFileSync(deckPath, 'utf8')) as { pages?: unknown[] }
  const proposals = (deck.pages ?? []).flatMap(page => {
    const contract = proposeImageContract(page)
    return contract ? [contract] : []
  })
  if (!proposals.length) return undefined
  const target = join(dirname(deckPath), 'image-slots.proposed.json')
  writeFileSync(target, `${JSON.stringify({ confirmed: false, note: '需确认后才写入页面。人物照片只用用户提供的照片。', contracts: proposals }, null, 2)}\n`)
  return target
}
