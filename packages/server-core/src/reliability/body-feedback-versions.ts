import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './artifact-versions'

const digest = (content: string) => createHash('sha256').update(content).digest('hex')
function versionPath(sessionPath: string, hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid body version')
  return join(sessionPath, 'data', 'body-feedback-versions', `${hash}.json`)
}
/** Preserve raw Markdown once per content identity, independently of message edits. */
export function saveBodyFeedbackVersion(sessionPath: string, content: string, hash: string): void {
  if (digest(content) !== hash) throw new Error('Body version identity changed')
  const path = versionPath(sessionPath, hash)
  if (!existsSync(path)) atomicWrite(path, JSON.stringify(content))
  if (readBodyFeedbackVersion(sessionPath, hash) !== content) throw new Error('Body version is damaged')
}
export function readBodyFeedbackVersion(sessionPath: string, hash: string): string | undefined {
  const path = versionPath(sessionPath, hash)
  if (!existsSync(path)) return undefined
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Body version is not a regular file')
  const content: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof content !== 'string' || digest(content) !== hash) throw new Error('Body version is damaged')
  return content
}
