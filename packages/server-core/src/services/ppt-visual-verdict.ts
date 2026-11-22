import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8 } from 'fflate'
import { z } from 'zod'
import { readOoxmlPackage } from './office-template/ooxml-package'
import { childrenNamed, firstChild, parseXml } from './office-template/xml-tree'

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
const reportSchema = verdictSchema.extend({
  sha256: digest,
  pageCount: page,
  screenshotDigests: z.record(z.string(), digest).optional(),
})
export type PptVisualRender = z.infer<typeof renderSchema>
type Verdict = z.infer<typeof verdictSchema>
type Report = z.infer<typeof reportSchema>
const attachmentSchema = z.array(z.union([z.string(), z.object({ path: z.string() })])).nonempty()

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

export function takeHeadlessVisualRenders(sessionDir: string): PptVisualRender[] {
  const dir = join(sessionDir, 'data', 'ppt-visual-renders')
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^\d+-[a-f0-9-]{36}\.json$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(({ name }) => {
        const path = join(dir, name)
        try {
          const value = json(readFileSync(path, 'utf8'))
          unlinkSync(path)
          const parsed = renderSchema.safeParse(value)
          return parsed.success ? [parsed.data] : []
        } catch { return [] }
      })
  } catch { return [] }
}

function renderRevisions(renders: PptVisualRender[]): PptVisualRender[] {
  const revisions = new Map<string, PptVisualRender>()
  for (const render of [...renders].reverse()) {
    try {
      const path = normalizedPath(render.path)
      const key = `${path}\0${render.sha256}`
      const revision = revisions.get(key)
      if (revision) revision.pages.push(...render.pages)
      else revisions.set(key, { ...render, path, pages: [...render.pages] })
    } catch { /* The source is no longer available. */ }
  }
  return [...revisions.values()]
}

function matchesScreenshot(image: PptVisualRender['pages'][number], attachment: string): boolean {
  try {
    return normalizedPath(image.path) === normalizedPath(attachment) && visualSha256(readFileSync(image.path)) === image.sha256
  } catch { return false }
}

function reviewRender(
  renders: PptVisualRender[], path: string, pages: number[], attachments?: string[],
): PptVisualRender | undefined {
  try {
    const canonical = normalizedPath(path)
    if (new Set(pages).size !== pages.length || (attachments && attachments.length !== pages.length)) return
    for (const render of renderRevisions(renders)) {
      if (render.path !== canonical) continue
      const selected = pages.map((page, index) => render.pages.find(image => image.page === page
        && (!attachments || matchesScreenshot(image, attachments[index]!))))
      if (!selected.every(image => image !== undefined)) continue
      return { ...render, pages: selected }
    }
  } catch { /* Missing render evidence cannot pass. */ }
}

function presentationPageCount(bytes: Uint8Array): number {
  const parts = readOoxmlPackage(bytes)
  const root = parseXml(strFromU8(parts['ppt/presentation.xml']!)).root
  for (const ns of ['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']) {
    const list = firstChild(root, ns, 'sldIdLst')
    if (list) return childrenNamed(list, ns, 'sldId').length
  }
  return 0
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

export function recordVisualVerdict(
  sessionDir: string, render: PptVisualRender, verdict: Verdict, allowLocalScope = false,
  capture: PptVisualRender = render,
): boolean | undefined {
  const pages = render.pages.map(image => image.page)
  if (!samePages(verdict.coveredPages, pages) || !render.pages.every(image => matchesScreenshot(image, image.path))) return
  const bytes = readFileSync(render.path)
  if (visualSha256(bytes) !== render.sha256) return
  const pageCount = presentationPageCount(bytes)
  if (!pageCount || pages.some(page => page > pageCount)) return
  const file = reportFile(sessionDir, render.path)
  const prior = previousReport(file)
  const sameRevision = prior?.sha256 === render.sha256
  const findings = sameRevision ? [...prior.findings, ...verdict.findings].slice(0, 200) : verdict.findings
  const inherited = sameRevision ? prior.coveredPages.slice() : []
  if (!sameRevision && allowLocalScope && prior?.coveredPages.length === pageCount && prior.pageCount === pageCount
    && capture.sha256 === render.sha256 && normalizedPath(capture.path) === normalizedPath(render.path)) {
    for (const page of prior.coveredPages) {
      if (pages.includes(page) || prior.findings.some(finding => finding.page === page)) continue
      const image = capture.pages.find(image => image.page === page)
      if (image && image.sha256 === prior.screenshotDigests?.[page] && matchesScreenshot(image, image.path)) inherited.push(page)
    }
  }
  const coveredPages = [...new Set([...inherited, ...pages])].sort((a, b) => a - b)
  const screenshotDigests = Object.fromEntries([
    ...inherited.flatMap(page => {
      const sha256 = prior?.screenshotDigests?.[page]
      return sha256 ? [[page, sha256] as const] : []
    }),
    ...render.pages.map(image => [image.page, image.sha256] as const),
  ])
  const record: Report = { sha256: render.sha256, pageCount, screenshotDigests, coveredPages, verdict: findings.length ? 'fail' : verdict.verdict, findings }
  mkdirSync(join(sessionDir, 'data', 'ppt-visual-verdicts'), { recursive: true })
  writeFileSync(file, JSON.stringify(record))
  return coveredPages.length === pageCount
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
  private fullyReviewed = new Set<string>()

  recordVerdict(sessionDir: string, render: PptVisualRender, verdict: Verdict, allowLocalScope: boolean): void {
    const path = normalizedPath(render.path)
    const local = allowLocalScope || this.fullyReviewed.has(path)
    const fresh = local ? renderRevisions(this.renders).find(candidate => candidate.path === path && candidate.sha256 === render.sha256) : undefined
    if (recordVisualVerdict(sessionDir, render, verdict, local, fresh)) {
      this.fullyReviewed.add(path)
    }
  }

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
    const attachments = attachmentSchema.safeParse(input.attachments)
    if (!request.success || !attachments.success) return
    const paths = attachments.data.map(item => typeof item === 'string' ? item : item.path)
    const render = reviewRender(this.renders, request.data.path, request.data.pages, paths)
    if (render) {
      this.delegated.add(render.sha256)
      this.pending.set(id, { render, attachments: paths })
    }
  }

  inferReview(input: Record<string, unknown>): {
    render: PptVisualRender
    finish: (text: string) => { render: PptVisualRender; verdict: Verdict } | undefined
  } | undefined {
    const attachments = attachmentSchema.safeParse(input.attachments)
    if (!attachments.success) return
    try {
      const paths = attachments.data.map(item => normalizedPath(typeof item === 'string' ? item : item.path))
      for (const candidate of renderRevisions(this.renders)) {
        const pages = paths.map(path => candidate.pages.find(image => matchesScreenshot(image, path))?.page)
        if (!pages.every(page => page !== undefined)) continue
        const render = reviewRender([candidate], candidate.path, pages, paths)
        if (!render || visualSha256(readFileSync(render.path)) !== render.sha256) continue
        this.delegated.add(render.sha256)
        return {
          render,
          finish: text => {
            const verdict = readVisualVerdict(text)
            if (verdict && reviewRender([render], render.path, pages, paths)) return { render, verdict }
          },
        }
      }
    } catch { /* Attachments not bound to a current render remain generic queries. */ }
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
      const latest = renderRevisions(this.renders).find(render => render.path === canonical)
      if (!latest || this.delegated.has(latest.sha256)) return
      const shown = latest.pages.filter(image => this.inspected.get(image.path) === image.sha256)
      const pages = verdict.coveredPages.map(page => shown.find(image => image.page === page))
      if (pages.every(image => image !== undefined)) return { render: { ...latest, pages }, verdict }
    } catch { /* Missing render evidence cannot pass. */ }
  }
}
