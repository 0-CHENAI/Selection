import type { ArtifactFeedback } from '@craft-agent/shared/protocol'

/** Textarea normalizes CRLF/CR to LF; stored anchors use the original UTF-16 offsets. */
export function artifactFeedbackAnchor(content: string, hash: string, start: number, end: number): NonNullable<ArtifactFeedback['anchor']> | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return undefined
  const offsets = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r' && content[i + 1] === '\n') i++
    offsets.push(i + 1)
  }
  const from = offsets[start], to = offsets[end]
  if (from === undefined || to === undefined) return undefined
  return { hash, start: from, end: to, text: content.slice(from, to) }
}
