import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent'
import type { Message } from '@earendil-works/pi-ai'

export interface CreatePiSessionManagerOptions {
  cwd: string
  sessionDir: string
  resumeSdkSessionId?: string
  branchFromSessionPath?: string
  branchFromSdkSessionId?: string
  branchFromSdkTurnId?: string
  forceFreshSession?: boolean
}

export const TOOL_IMAGE_SIDECAR_DIR = 'tool-images'
export const TOOL_IMAGE_PERSISTENCE_PREFIX = '[Inline tool image omitted from session JSONL]'

const LEGACY_TOOL_IMAGE_PLACEHOLDER =
  '[Inline tool image omitted from session JSONL; use the artifact path and metadata in the text result.]'

const RICH_PLACEHOLDER_RE =
  /^\[Inline tool image omitted from session JSONL\] sha256=([a-f0-9]+) mime=(\S+) bytes=(\d+)$/
const ARTIFACT_PATH_RE = /(?:Artifact:|Stored at:)\s+(\S+)/g
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'])
const MAX_TOOL_IMAGE_BYTES = 20 * 1024 * 1024

function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null
  let best: { path: string; mtime: number } | null = null
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue
    const fullPath = join(sessionDir, entry)
    const mtime = statSync(fullPath).mtimeMs
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime }
    }
  }
  return best?.path ?? null
}

function findSessionFileById(sessionDir: string, sdkSessionId?: string): string | null {
  if (!sdkSessionId || !existsSync(sessionDir)) return null
  const suffix = `_${sdkSessionId}.jsonl`
  const entry = readdirSync(sessionDir).find(name => name.endsWith(suffix))
  return entry ? join(sessionDir, entry) : null
}

function mimeFromPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.tif':
    case '.tiff':
      return 'image/tiff'
    default:
      return 'image/png'
  }
}

function writeToolImageSidecar(
  sessionDir: string,
  data: string,
  mimeType: string,
): { sha256: string; bytes: number; mimeType: string } {
  const bytes = Buffer.from(data, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const dir = join(sessionDir, TOOL_IMAGE_SIDECAR_DIR)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, sha256)
  if (!existsSync(dest)) writeFileSync(dest, bytes)
  return { sha256, bytes: bytes.byteLength, mimeType }
}

function formatRichPlaceholder(meta: { sha256: string; mimeType: string; bytes: number }): string {
  return `${TOOL_IMAGE_PERSISTENCE_PREFIX} sha256=${meta.sha256} mime=${meta.mimeType} bytes=${meta.bytes}`
}

function isToolImagePlaceholder(text: string): boolean {
  return text.startsWith('[Inline tool image omitted from session JSONL')
}

function collectArtifactPaths(text: string): string[] {
  return [...text.matchAll(ARTIFACT_PATH_RE)].map(match => match[1]!).filter(Boolean)
}

function readImageFromPath(
  filePath: string,
  options?: { requireImageExtension?: boolean },
): { type: 'image'; data: string; mimeType: string } | null {
  try {
    if (options?.requireImageExtension && !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return null
    }
    if (!existsSync(filePath)) return null
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TOOL_IMAGE_BYTES) return null
    const data = readFileSync(filePath).toString('base64')
    return { type: 'image', data, mimeType: mimeFromPath(filePath) }
  } catch {
    return null
  }
}

function copyToolImageSidecars(fromSessionDir: string, toSessionDir: string): void {
  if (!fromSessionDir || fromSessionDir === toSessionDir) return
  const sourceDir = join(fromSessionDir, TOOL_IMAGE_SIDECAR_DIR)
  if (!existsSync(sourceDir)) return
  const destDir = join(toSessionDir, TOOL_IMAGE_SIDECAR_DIR)
  mkdirSync(destDir, { recursive: true })
  for (const name of readdirSync(sourceDir)) {
    const from = join(sourceDir, name)
    const to = join(destDir, name)
    try {
      if (!statSync(from).isFile() || existsSync(to)) continue
      copyFileSync(from, to)
    } catch {
      // Best-effort: rehydrate can still look up the parent session dir.
    }
  }
}

function sidecarLookupDirs(manager: PiSessionManager): string[] {
  const dirs = [manager.getSessionDir()]
  const parentSession = manager.getHeader()?.parentSession
  if (parentSession) {
    const parentDir = dirname(parentSession)
    if (parentDir && parentDir !== dirs[0]) dirs.push(parentDir)
  }
  return dirs
}

function resolveCandidatePath(candidate: string, sessionDir: string): string {
  if (isAbsolute(candidate)) return candidate
  return join(sessionDir, candidate)
}

/**
 * Tool images are delivered to the active model turn, but persisting their
 * Base64 payload would make Pi's JSONL large. Write a sidecar under the
 * session dir and keep only a metadata placeholder in JSONL so resume can
 * rehydrate pixels without embedding the original image in the transcript.
 */
export function sanitizePiMessageForPersistence(message: Message, sessionDir?: string): Message {
  if (message.role !== 'toolResult' || !message.content.some(part => part.type === 'image')) {
    return message
  }

  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'image') return part
      if (sessionDir) {
        try {
          const meta = writeToolImageSidecar(sessionDir, part.data, part.mimeType)
          return { type: 'text' as const, text: formatRichPlaceholder(meta) }
        } catch {
          // Fall through to the legacy placeholder if the sidecar cannot be written.
        }
      }
      return { type: 'text' as const, text: LEGACY_TOOL_IMAGE_PLACEHOLDER }
    }),
  }
}

export function rehydratePiToolImages<T extends { role?: string; content?: unknown }>(
  message: T,
  sessionDir: string | string[],
): T {
  if (message.role !== 'toolResult' || !Array.isArray(message.content)) return message

  const lookupDirs = (Array.isArray(sessionDir) ? sessionDir : [sessionDir]).filter(Boolean)
  const primaryDir = lookupDirs[0]
  if (!primaryDir) return message

  const content = message.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  if (!content.some(part => part.type === 'text' && part.text && isToolImagePlaceholder(part.text))) {
    return message
  }

  const siblingText = content
    .filter(part => part.type === 'text' && part.text && !isToolImagePlaceholder(part.text))
    .map(part => part.text!)
    .join('\n')
  const unusedArtifacts = collectArtifactPaths(siblingText)

  let changed = false
  const next = content.map((part) => {
    if (part.type !== 'text' || !part.text || !isToolImagePlaceholder(part.text)) return part

    const rich = part.text.match(RICH_PLACEHOLDER_RE)
    if (rich) {
      const sha256 = rich[1]!
      const mimeType = rich[2]!
      for (const dir of lookupDirs) {
        const loaded = readImageFromPath(join(dir, TOOL_IMAGE_SIDECAR_DIR, sha256))
        if (loaded) {
          changed = true
          return { type: 'image' as const, data: loaded.data, mimeType }
        }
      }
    }

    for (let index = 0; index < unusedArtifacts.length; index++) {
      const loaded = readImageFromPath(resolveCandidatePath(unusedArtifacts[index]!, primaryDir), {
        requireImageExtension: true,
      })
      if (!loaded) continue
      unusedArtifacts.splice(index, 1)
      changed = true
      return loaded
    }

    return part
  })

  return changed ? { ...message, content: next } : message
}

function protectSessionJsonl(manager: PiSessionManager): PiSessionManager {
  const sessionDir = manager.getSessionDir()
  const lookupDirs = sidecarLookupDirs(manager)
  const appendMessage = manager.appendMessage.bind(manager)
  manager.appendMessage = ((message: Message) =>
    appendMessage(sanitizePiMessageForPersistence(message, sessionDir))) as PiSessionManager['appendMessage']

  const buildSessionContext = manager.buildSessionContext.bind(manager)
  manager.buildSessionContext = (() => {
    const context = buildSessionContext()
    return {
      ...context,
      messages: context.messages.map(entry => rehydratePiToolImages(entry, lookupDirs)),
    }
  }) as PiSessionManager['buildSessionContext']

  return manager
}

/** Select the exact Pi history used by a normal send, branch, or regenerate. */
export function createPiSessionManager(options: CreatePiSessionManagerOptions): PiSessionManager {
  const {
    cwd,
    sessionDir,
    resumeSdkSessionId,
    branchFromSessionPath,
    branchFromSdkSessionId,
    branchFromSdkTurnId,
    forceFreshSession,
  } = options

  if (branchFromSessionPath) {
    const parentSessionDir = join(branchFromSessionPath, '.pi-sessions')
    const parentSessionFile = findSessionFileById(parentSessionDir, branchFromSdkSessionId)
      ?? findMostRecentSessionFile(parentSessionDir)
    if (!parentSessionFile) {
      throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentSessionDir}`)
    }

    const forked = PiSessionManager.forkFrom(parentSessionFile, cwd, sessionDir)
    copyToolImageSidecars(parentSessionDir, sessionDir)
    if (branchFromSdkTurnId) {
      if (!forked.getEntry(branchFromSdkTurnId)) {
        throw new Error(`Pi branch preflight failed: branch anchor not found: ${branchFromSdkTurnId}`)
      }
      forked.branch(branchFromSdkTurnId)
    }
    return protectSessionJsonl(forked)
  }

  if (forceFreshSession) {
    return protectSessionJsonl(PiSessionManager.create(cwd, sessionDir))
  }

  const requestedSessionFile = findSessionFileById(sessionDir, resumeSdkSessionId)
  return protectSessionJsonl(requestedSessionFile
    ? PiSessionManager.open(requestedSessionFile, sessionDir, cwd)
    : PiSessionManager.continueRecent(cwd, sessionDir))
}
