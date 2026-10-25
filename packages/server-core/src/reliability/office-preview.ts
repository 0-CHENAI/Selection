import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { unzipSync } from 'fflate'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { OFFICE_PREVIEW_MAX_OPEN, OFFICE_PREVIEW_IDLE_TTL_MS, OFFICE_PREVIEW_MAX_SELECTION, type OfficeSelection, type OfficePreviewResult } from '@craft-agent/shared/protocol'

const exec = promisify(execFile)
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const env = () => ({ ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_WATCH_IDLE_SECONDS: String(OFFICE_PREVIEW_IDLE_TTL_MS / 1000) })
function binary() {
  // Use the executable directly (not a shell wrapper, including on Windows).
  const path = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
  if (!path || /\.(cmd|bat)$/i.test(path)) throw new Error('OfficeCLI executable is unavailable on this host')
  return path
}
function completeOfficePackage(bytes: Buffer): boolean {
  try {
    const parts = unzipSync(bytes, { filter: file => file.name === '[Content_Types].xml' })
    return !!parts['[Content_Types].xml']?.length
  } catch {
    return false
  }
}

/** Live package bytes when the file changed and is still a complete Office zip; otherwise the snapshot. */
export function officePreviewBytes(snapshot: Buffer, filePath: string): Buffer {
  try {
    const live = readFileSync(filePath)
    if (live.equals(snapshot)) return snapshot
    if (!completeOfficePackage(live)) return snapshot
    return live
  } catch {
    return snapshot
  }
}

export async function officeNodes(file: string, path: string): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await exec(binary(), ['get', file, path, '--json'], { env: env(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
  const result = JSON.parse(stdout)
  if (result.success !== true || !Array.isArray(result.data?.results)) throw new Error('OfficeCLI could not resolve the selected elements')
  return result.data.results
}
export function officeElement(node: Record<string, unknown>): OfficeSelection['elements'][number] {
  if (typeof node.path !== 'string' || !node.path.startsWith('/') || typeof node.type !== 'string') throw new Error('Invalid Office element')
  return { path: node.path, type: node.type, summary: String(node.text ?? node.preview ?? node.type).slice(0, 500), digest: digest(JSON.stringify(node)) }
}
export async function verifyOfficeSelection(file: string, selection: OfficeSelection): Promise<void> {
  if (digest(await readFile(file)) !== selection.hash) throw new Error('文件已变化，请重新打开预览并选择目标')
  for (const element of selection.elements) {
    const nodes = await officeNodes(file, element.path)
    if (nodes.length !== 1 || officeElement(nodes[0]!).digest !== element.digest) throw new Error('选中元素已变化，请重新选择')
  }
  if (digest(await readFile(file)) !== selection.hash) throw new Error('文件在核验期间发生变化，请重新选择')
}
interface Preview {
  id: string; sessionId: string; artifactId: string; baseVersion: string; path: string; hash: string
  directory: string; copy: string; process: ChildProcess; port: number; touched: number; captures: Set<string>
  isDraft: boolean
  html: string; owners: Map<string, number>; stopping?: Promise<void>
  selectedElements?: OfficeSelection['elements']
  /** data-path values the preview painted, kept so a file swap can restore them. */
  selectedPaths?: string[]
}
/** Each preview owns a private copy and a process. No watch HTTP endpoint is exposed to the client. */
export class OfficePreviewService {
  private previews = new Map<string, Preview>()
  private opening = new Map<string, { sessionId: string }>()
  private starting = new Set<{ sessionId: string; process?: ChildProcess }>()
  private operations: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private disposed = false

  // Serialize admission through startup/termination. Reserved and stopping processes
  // count toward the limit, including replacement renders at full capacity.
  async open(sessionId: string, artifactId: string, baseVersion: string, path: string, bytes: Buffer, isDraft = false, _replaceExisting = true, ownerId = 'legacy', knownPreviewId?: string): Promise<OfficePreviewResult> {
    if (!/\.(docx|xlsx|pptx)$/i.test(path)) throw new Error('请选择 Word、Excel 或 PowerPoint 文件')
    const key = JSON.stringify([sessionId, ownerId]), ticket = { sessionId }
    this.opening.set(key, ticket)
    const result = this.operations.catch(() => {}).then(async () => {
      const valid = () => !this.disposed && this.opening.get(key) === ticket
      if (!valid()) throw new Error('Office 预览请求已被替换或取消')
      await this.prune()
      const previous = [...this.previews.values()].find(p => p.sessionId === sessionId && p.path === path && !p.stopping)
      const hash = digest(bytes)
      if (previous && previous.artifactId === artifactId && previous.baseVersion === baseVersion && previous.hash === hash && previous.isDraft === isDraft) {
        this.activate(previous, ownerId)
        await this.heartbeat(sessionId, previous.id, ownerId)
        if (!valid()) throw new Error('Office 预览请求已被替换或取消')
        return { ...this.result(previous), ...(knownPreviewId === previous.id ? {} : { html: previous.html }) }
      }
      if (previous) {
      if (!completeOfficePackage(bytes)) throw new Error('Office 候选文件尚未写入完成')
      }
      await this.makeRoom(previous)
      if (!valid()) throw new Error('Office 预览请求已被替换或取消')
      const reservation: { sessionId: string; process?: ChildProcess } = { sessionId }
      this.starting.add(reservation)
      let directory: string | undefined, preview: Preview | undefined
      try {
        directory = await mkdtemp(join(tmpdir(), 'selection-office-preview-'))
        const copy = join(directory, `document${extname(path).toLowerCase()}`)
        await writeFile(copy, bytes, { mode: 0o600 })
        if (!valid()) throw new Error('Office 预览请求已被替换或取消')
        const child = reservation.process = spawn(binary(), ['watch', copy, '--port', '0'], { env: env(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        const port = await new Promise<number>((resolve, reject) => {
          let output = ''
          const timer = setTimeout(() => reject(new Error('Office 预览启动超时')), 30_000)
          child.once('error', error => { clearTimeout(timer); reject(error) })
          child.once('exit', () => { clearTimeout(timer); reject(new Error('Office 预览进程退出')) })
          child.stderr?.resume()
          child.stdout?.on('data', data => {
            output = (output + data.toString()).slice(-4096)
            const match = output.match(/Watch: http:\/\/localhost:(\d+)/)
            if (match) { clearTimeout(timer); resolve(Number(match[1])) }
          })
        })
        const owners = new Map(previous?.owners)
        owners.set(ownerId, Date.now())
        preview = { id: randomUUID(), sessionId, artifactId, baseVersion, path, hash, directory, copy, process: child, port,
          touched: Date.now(), captures: new Set(), isDraft, html: '', owners }
        const registered = preview
        this.previews.set(preview.id, preview)
        this.activate(preview, ownerId)
        this.starting.delete(reservation)
        this.timer ??= setInterval(() => { void this.prune() }, 15_000).unref()
        child.once('exit', () => {
          this.previews.delete(registered.id)
          this.stopIdleTimer()
          void rm(registered.directory, { recursive: true, force: true })
        })
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error('Office 预览无法加载')
        const html = await response.text()
        if (html.length > 16 * 1024 * 1024) throw new Error('Office 预览过大，请缩小文档后重试')
        if (!valid() || preview.stopping || child.exitCode !== null || child.signalCode !== null) throw new Error('Office 预览请求已被替换或取消')
        preview.html = html
        if (previous && previous.id !== preview.id) await this.close(sessionId, previous.id)
        return { ...this.result(preview), html }
      } catch (error) {
        if (preview) await this.close(sessionId, preview.id)
        else if (reservation.process) await this.terminate(reservation.process)
        if (directory) await rm(directory, { recursive: true, force: true })
        throw error
      } finally { this.starting.delete(reservation) }
    }).finally(() => { if (this.opening.get(key) === ticket) this.opening.delete(key) })
    this.operations = result.catch(() => {})
    return result
  }

  private async makeRoom(replacement?: Preview) {
    while (this.previews.size + this.starting.size >= OFFICE_PREVIEW_MAX_OPEN) {
      const idle = [...this.previews.values()].filter(p => p !== replacement && !p.stopping && !p.owners.size).sort((a, b) => a.touched - b.touched)[0]
      const stopping = [...this.previews.values()].find(p => p.stopping)
      if (idle) await this.close(idle.sessionId, idle.id)
      else if (stopping) await stopping.stopping
      else if (replacement) await this.close(replacement.sessionId, replacement.id)
      else throw new Error('最多同时打开 5 个 Office 预览，请先关闭一个正在使用的预览')
    }
  }

  private async prune() {
    const now = Date.now()
    for (const preview of this.previews.values()) {
      // Lost clients stop pinning a foreground slot; this does not keep an idle process alive.
      for (const [owner, seen] of preview.owners) if (now - seen >= 60_000) preview.owners.delete(owner)
      if (now - preview.touched >= OFFICE_PREVIEW_IDLE_TTL_MS) await this.close(preview.sessionId, preview.id)
    }
  }

  private terminate(child: ChildProcess): Promise<void> {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise(resolve => {
      const force = setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      child.once('exit', () => { clearTimeout(force); resolve() })
      child.kill()
    })
  }
  private activate(preview: Preview, ownerId: string) {
    for (const other of this.previews.values()) if (other !== preview && other.owners.delete(ownerId) && !other.owners.size) other.touched = Date.now()
    preview.owners.set(ownerId, Date.now())
  }
  private get(sessionId: string, id: string, ownerId?: string) {
    const preview = this.previews.get(id)
    if (!preview || preview.sessionId !== sessionId || preview.stopping || preview.process.exitCode !== null || preview.process.signalCode !== null || Date.now() - preview.touched >= OFFICE_PREVIEW_IDLE_TTL_MS) throw new Error('预览已关闭或过期，请重新打开')
    if (ownerId && !preview.owners.has(ownerId)) throw new Error('预览已休眠，请返回会话后重试')
    preview.touched = Date.now()
    if (ownerId) preview.owners.set(ownerId, preview.touched)
    return preview
  }
  private result(p: Preview): OfficePreviewResult { return { previewId: p.id, artifactId: p.artifactId, baseVersion: p.baseVersion, path: p.path, isDraft: p.isDraft } }
  describe(sessionId: string, id: string, ownerId?: string) { return this.result(this.get(sessionId, id, ownerId)) }
  suspend(sessionId: string, id: string, ownerId = 'legacy') {
    const p = this.previews.get(id)
    if (!p || p.stopping) return
    if (p.sessionId !== sessionId) throw new Error('预览属于另一会话')
    if (p.owners.delete(ownerId) && !p.owners.size) p.touched = Date.now()
  }
  async refresh(sessionId: string, id: string, bytes: Buffer, baseVersion: string, isDraft: boolean, ownerId = 'legacy') {
    const p = this.get(sessionId, id, ownerId)
    if (p.hash === digest(bytes) && p.isDraft === isDraft && p.baseVersion === baseVersion) return this.heartbeat(sessionId, id, ownerId)
    // Watch can return a successful error page for a partially written package.
    // Check the ZIP directory before replacing the last usable preview.
    if (!completeOfficePackage(bytes)) throw new Error('Office 候选文件尚未写入完成')
    try {
      return await this.replaceWatched(p, bytes, baseVersion, isDraft, ownerId)
    } catch (error) {
      // Same-path switch is a no-op in OfficeCLI, and a dead watch cannot swap.
      // Fall back to a new process only then. makeRoom stops the old one first.
      if (error instanceof Error && error.message === 'Office 候选文件尚未写入完成') throw error
      const next = await this.open(sessionId, p.artifactId, baseVersion, p.path, bytes, isDraft, false, ownerId)
      await this.close(sessionId, id)
      return next
    }
  }

  /** Point the running watch at a new copy. Restarting it flashes the iframe and drops the scroll position. */
  private async replaceWatched(p: Preview, bytes: Buffer, baseVersion: string, isDraft: boolean, ownerId: string): Promise<OfficePreviewResult> {
    const ext = extname(p.copy) || extname(p.path) || '.pptx'
    const nextCopy = join(p.directory, `document-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`)
    await writeFile(nextCopy, bytes, { mode: 0o600 })
    const switched = await fetch(`http://127.0.0.1:${p.port}/api/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: nextCopy }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!switched.ok) {
      await rm(nextCopy, { force: true }).catch(() => {})
      throw new Error('Office 预览未能换入新文档')
    }
    const previous = p.copy
    const paths = p.selectedPaths
    p.copy = nextCopy
    p.hash = digest(bytes)
    p.baseVersion = baseVersion
    p.isDraft = isDraft
    p.selectedElements = undefined
    p.selectedPaths = undefined
    if (paths?.length && !isDraft) {
      try { await this.select(p.sessionId, p.id, paths, ownerId) }
      catch { p.selectedElements = undefined; p.selectedPaths = undefined }
    }
    const response = await fetch(`http://127.0.0.1:${p.port}/`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Office 预览无法加载')
    const html = await response.text()
    if (html.length > 16 * 1024 * 1024) throw new Error('Office 预览过大，请缩小文档后重试')
    if (previous !== nextCopy) await rm(previous, { force: true }).catch(() => {})
    const selection = p.selectedElements ? { previewId: p.id, artifactId: p.artifactId, baseVersion: p.baseVersion, path: p.path, hash: p.hash, elements: p.selectedElements } : undefined
    return { ...this.result(p), html, ...(selection ? { selection } : {}) }
  }
  async heartbeat(sessionId: string, id: string, ownerId = 'legacy') {
    const p = this.get(sessionId, id, ownerId)
    // HTTP activity also keeps OfficeCLI's own orphan timeout alive.
    await fetch(`http://127.0.0.1:${p.port}/api/status`, { signal: AbortSignal.timeout(5000) }).then(r => r.arrayBuffer())
    return this.result(p)
  }
  async select(sessionId: string, id: string, paths: string[], ownerId = 'legacy') {
    const p = this.get(sessionId, id, ownerId)
    if (p.isDraft) throw new Error('修改中的临时副本仅供预览，请等待验证完成')
    if (!Array.isArray(paths) || paths.length > OFFICE_PREVIEW_MAX_SELECTION || paths.some(path => typeof path !== 'string' || path.length > 1024 || !path.startsWith('/') || /[\x00-\x1f]/.test(path))) {
      throw new Error(`最多选择 ${OFFICE_PREVIEW_MAX_SELECTION} 个元素；大表格请分批选择`)
    }
    p.selectedElements = undefined
    p.selectedPaths = undefined
    const response = await fetch(`http://127.0.0.1:${p.port}/api/selection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }), signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('无法更新 Office 选择')
    const elements = (await officeNodes(p.copy, 'selected')).map(officeElement)
    p.selectedElements = elements
    p.selectedPaths = paths
    return { ...this.result(p), selection: { previewId: p.id, artifactId: p.artifactId, baseVersion: p.baseVersion, path: p.path, hash: p.hash, elements } }
  }
  async capture(sessionId: string, id: string, ownerId = 'legacy') {
    const p = this.get(sessionId, id, ownerId)
    if (p.isDraft) throw new Error('修改中的临时副本仅供预览，请等待验证完成')
    const elements = p.selectedElements ?? (await officeNodes(p.copy, 'selected')).map(officeElement)
    if (!elements.length || elements.length > OFFICE_PREVIEW_MAX_SELECTION) throw new Error(`请先选择目标元素；最多选择 ${OFFICE_PREVIEW_MAX_SELECTION} 个`)
    const selection: OfficeSelection = { previewId: p.id, artifactId: p.artifactId, baseVersion: p.baseVersion, hash: p.hash, path: p.path, elements }
    // The nodes were resolved from this private snapshot on selection. Hashing
    // both files proves those bytes are unchanged without spawning 2*N CLIs.
    const [copyBytes, sourceBytes] = await Promise.all([readFile(p.copy), readFile(p.path)])
    if (digest(copyBytes) !== p.hash || digest(sourceBytes) !== p.hash) throw new Error('文件已变化，请重新打开预览并选择目标')
    // Later pointer gestures must not revoke an already submitted snapshot.
    p.captures.add(digest(JSON.stringify(selection)))
    if (p.captures.size > 32) p.captures.delete(p.captures.values().next().value!)
    return { ...this.result(p), selection }
  }
  assertCaptured(sessionId: string, selection: OfficeSelection) {
    const p = this.get(sessionId, selection.previewId)
    if (!p.captures.has(digest(JSON.stringify(selection)))) throw new Error('选择快照无效，请重新选择')
  }
  async close(sessionId: string, id: string, ownerId?: string) {
    const p = this.previews.get(id)
    if (!p) return
    if (p.sessionId !== sessionId) throw new Error('预览属于另一会话')
    if (ownerId) {
      p.owners.delete(ownerId)
      if (p.owners.size) return
    }
    p.stopping ??= this.terminate(p.process).then(async () => {
      this.previews.delete(id)
      await rm(p.directory, { recursive: true, force: true })
      this.stopIdleTimer()
    })
    await p.stopping
  }
  async closeSession(sessionId: string) {
    for (const [key, ticket] of this.opening) if (ticket.sessionId === sessionId) this.opening.delete(key)
    await Promise.all([
      ...[...this.previews.values()].filter(p => p.sessionId === sessionId).map(p => this.close(sessionId, p.id)),
      ...[...this.starting].filter(p => p.sessionId === sessionId && p.process).map(p => this.terminate(p.process!)),
    ])
  }
  private stopIdleTimer() { if (!this.previews.size) { clearInterval(this.timer); this.timer = undefined } }
  dispose() {
    this.disposed = true; this.opening.clear(); clearInterval(this.timer); this.timer = undefined
    for (const reservation of this.starting) if (reservation.process) void this.terminate(reservation.process)
    for (const p of this.previews.values()) void this.close(p.sessionId, p.id)
  }
}
