import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { strFromU8 } from 'fflate'
import { z } from 'zod'
import { readOoxmlPackage } from './office-template/ooxml-package'
import { childrenNamed, firstChild, getAttr, parseXml } from './office-template/xml-tree'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const page = z.number().int().positive()
const renderSchema = z.object({
  path: z.string(),
  sha256: digest,
  pages: z.array(z.object({ page, path: z.string(), sha256: digest })).nonempty(),
})
const verdictSchema = z.object({
  coveredPages: z.array(page).nonempty(),
  verdict: z.enum(['pass', 'fail']),
  findings: z.array(z.object({ page, issue: z.string().trim().min(1).max(500) })).max(200),
})
const reportSchema = verdictSchema.extend({ sha256: digest, pageCount: page, pageDigests: z.array(digest) })
export type PptVisualRender = z.infer<typeof renderSchema>
type Verdict = z.infer<typeof verdictSchema>
type Report = z.infer<typeof reportSchema>

export function visualSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function json(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function normalizedPath(path: string): string {
  const canonical = realpathSync(path)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function samePages(left: number[], right: number[]): boolean {
  return left.length === right.length && new Set(left).size === right.length && left.every(page => right.includes(page))
}

export function readVisualRender(result: string): PptVisualRender | undefined {
  for (const line of result.split(/\r?\n/).reverse()) {
    if (!line.includes('"pptVisualRender"')) continue
    const parsed = renderSchema.safeParse((json(line) as { pptVisualRender?: unknown } | undefined)?.pptVisualRender)
    if (parsed.success) return parsed.data
  }
}

export function reviewRender(
  renders: PptVisualRender[], path: string, pages: number[], attachments?: string[],
): PptVisualRender | undefined {
  try {
    const canonical = normalizedPath(path)
    for (const render of [...renders].reverse()) {
      if (normalizedPath(render.path) !== canonical) continue
      const selected = pages.map(page => render.pages.find(image => image.page === page))
      if (!selected.every(image => image !== undefined) || new Set(pages).size !== pages.length) continue
      if (attachments && (attachments.length !== selected.length || !selected.every((image, index) =>
        normalizedPath(image.path) === normalizedPath(attachments[index]!) && visualSha256(readFileSync(image.path)) === image.sha256))) continue
      return { ...render, pages: selected }
    }
  } catch { /* Missing render evidence cannot pass. */ }
}

function presentationPages(bytes: Uint8Array): { count: number; digests: string[] } {
  const parts = readOoxmlPackage(bytes)
  const root = parseXml(strFromU8(parts['ppt/presentation.xml']!)).root
  for (const ns of ['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']) {
    const list = firstChild(root, ns, 'sldIdLst')
    if (!list) continue
    const slides = childrenNamed(list, ns, 'sldId')
    const rels = parseXml(strFromU8(parts['ppt/_rels/presentation.xml.rels']!)).root
    const targets = new Map(childrenNamed(rels, 'http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')
      .map(rel => [getAttr(rel, null, 'Id'), getAttr(rel, null, 'Target')]))
    const paths = slides.map(slide => {
      const id = getAttr(slide, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        ?? getAttr(slide, 'http://purl.oclc.org/ooxml/officeDocument/relationships', 'id')
      const target = targets.get(id)
      return target ? (target.startsWith('/') ? target.slice(1) : posix.join('ppt', target)) : ''
    })
    if (new Set(paths).size !== paths.length || !paths.every(path => /^ppt\/slides\/[^/]+\.xml$/.test(path) && parts[path])) {
      return { count: slides.length, digests: [] }
    }
    const local = paths.map(path => [path, posix.join(posix.dirname(path), '_rels', posix.basename(path) + '.rels')])
    const localParts = new Set(local.flat())
    // A change to shared resources, layout, theme or presentation order invalidates prior page evidence.
    const common = createHash('sha256')
    for (const name of Object.keys(parts).sort()) {
      if (!localParts.has(name) && !name.startsWith('docProps/')) common.update(name + '\0' + visualSha256(parts[name]!))
    }
    const commonDigest = common.digest('hex')
    return { count: slides.length, digests: local.map(names => {
      const hash = createHash('sha256').update(commonDigest)
      for (const name of names) hash.update(name + '\0' + (parts[name] ? visualSha256(parts[name]!) : ''))
      return hash.digest('hex')
    }) }
  }
  return { count: 0, digests: [] }
}

function reportFile(sessionDir: string, path: string): string {
  return join(sessionDir, 'data', 'ppt-visual-verdicts', createHash('sha256').update(normalizedPath(path)).digest('hex') + '.json')
}

export function markVisualDeliveryBlocked(sessionDir: string, path: string): void {
  const file = reportFile(sessionDir, path)
  mkdirSync(join(sessionDir, 'data', 'ppt-visual-verdicts'), { recursive: true })
  writeFileSync(file + '.delivery', '')
}

export function hasVisualDeliveryBlock(sessionDir: string, path: string): boolean {
  try {
    readFileSync(reportFile(sessionDir, path) + '.delivery')
    return !!pptVisualBlock(sessionDir, path)
  } catch { return false }
}

function previousReport(file: string): Report | undefined {
  try {
    const parsed = reportSchema.safeParse(json(readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch { return undefined }
}

export function readVisualVerdict(text: string): Verdict | undefined {
  const parsed = verdictSchema.safeParse(json(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')))
  if (!parsed.success) return undefined
  const verdict = parsed.data
  if (verdict.findings.some(finding => !verdict.coveredPages.includes(finding.page))) return undefined
  if (verdict.verdict === 'fail' && !verdict.findings.length) return undefined
  return { ...verdict, verdict: verdict.findings.length ? 'fail' : verdict.verdict }
}

export function recordVisualVerdict(sessionDir: string, render: PptVisualRender, verdict: Verdict, allowLocalScope = false): void {
  const pages = render.pages.map(image => image.page)
  if (!samePages(verdict.coveredPages, pages)) return
  const bytes = readFileSync(render.path)
  if (visualSha256(bytes) !== render.sha256) return
  const { count: pageCount, digests: pageDigests } = presentationPages(bytes)
  if (!pageCount || pages.some(page => page > pageCount)) return
  const file = reportFile(sessionDir, render.path)
  const prior = previousReport(file)
  const sameRevision = prior?.sha256 === render.sha256
  const findings = sameRevision ? [...prior.findings, ...verdict.findings].slice(0, 200) : verdict.findings
  const inherited = sameRevision ? prior.coveredPages
    : allowLocalScope && prior?.verdict === 'pass' && prior.coveredPages.length === pageCount && prior.pageCount === pageCount
      && pageDigests.length === pageCount
      ? prior.coveredPages.filter(page => prior.pageDigests[page - 1] === pageDigests[page - 1]) : []
  const coveredPages = [...new Set([...inherited, ...pages])].sort((a, b) => a - b)
  const record: Report = { sha256: render.sha256, pageCount, pageDigests, coveredPages, verdict: findings.length ? 'fail' : verdict.verdict, findings }
  mkdirSync(join(sessionDir, 'data', 'ppt-visual-verdicts'), { recursive: true })
  writeFileSync(file, JSON.stringify(record))
}

export type PptVisualBlock = {
  reason: 'missing' | 'stale' | 'coverage' | 'failed'
  pages?: number[]
  findings?: Verdict['findings']
}

export function pptVisualBlock(sessionDir: string, path: string): PptVisualBlock | undefined {
  try {
    const report = previousReport(reportFile(sessionDir, path))
    if (!report) return { reason: 'missing' }
    if (report.sha256 !== visualSha256(readFileSync(path))) return { reason: 'stale' }
    if (report.verdict === 'fail' || report.findings.length) {
      return { reason: 'failed', pages: [...new Set(report.findings.map(finding => finding.page))], findings: report.findings }
    }
    const missing = Array.from({ length: report.pageCount }, (_, index) => index + 1).filter(page => !report.coveredPages.includes(page))
    if (missing.length) return { reason: 'coverage', pages: missing }
  } catch { return { reason: 'missing' } }
}

export class PptVisualTurn {
  private renders: PptVisualRender[] = []
  private inspected = new Map<string, string>()
  private pending = new Map<string, { render: PptVisualRender; attachments: string[] }>()
  private delegated = new Set<string>()

  addRender(render: PptVisualRender, shown = false): void {
    this.renders.push(render)
    if (shown) for (const page of render.pages) this.inspected.set(page.path, page.sha256)
  }

  noteRead(path: string): void {
    try {
      const file = normalizedPath(path)
      const image = this.renders.flatMap(render => render.pages).find(image => normalizedPath(image.path) === file
        && visualSha256(readFileSync(image.path)) === image.sha256)
      if (image) this.inspected.set(image.path, image.sha256)
    } catch { /* Cannot bind the Read result to a known render. */ }
  }

  beginReview(id: string, input: Record<string, unknown>): void {
    const request = z.object({ path: z.string(), pages: z.array(page).nonempty() }).safeParse(input.pptReview)
    const attachments = z.array(z.union([z.string(), z.object({ path: z.string() })])).safeParse(input.attachments)
    if (!request.success || !attachments.success) return
    const paths = attachments.data.map(item => typeof item === 'string' ? item : item.path)
    const render = reviewRender(this.renders, request.data.path, request.data.pages, paths)
    if (render) {
      this.delegated.add(render.sha256)
      this.pending.set(id, { render, attachments: paths })
    }
  }

  finishReview(id: string, text: string): { render: PptVisualRender; verdict: Verdict } | undefined {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    const verdict = readVisualVerdict(text)
    if (!pending || !verdict) return
    const { render, attachments } = pending
    if (reviewRender([render], render.path, render.pages.map(image => image.page), attachments)) return { render, verdict }
  }

  directReview(text: string): { render: PptVisualRender; verdict: Verdict } | undefined {
    const packet = json(text) as { path?: string } | undefined
    const verdict = readVisualVerdict(text)
    if (!verdict || typeof packet?.path !== 'string') return
    try {
      const canonical = normalizedPath(packet.path)
      const latest = this.renders.findLast(render => normalizedPath(render.path) === canonical)
      if (!latest || this.delegated.has(latest.sha256)) return
      const shown = this.renders.filter(render => render.sha256 === latest.sha256 && normalizedPath(render.path) === canonical)
        .flatMap(render => render.pages).filter(image => this.inspected.get(image.path) === image.sha256)
      const pages = verdict.coveredPages.map(page => shown.find(image => image.page === page))
      if (pages.every(image => image !== undefined)) return { render: { ...latest, pages }, verdict }
    } catch { /* Missing render evidence cannot pass. */ }
  }
}
