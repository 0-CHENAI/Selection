export interface ParsedSkillUsedContent {
  content: string
  skills: string[]
  hasPendingMarker: boolean
}

const SKILL_USED_PREFIX = '[skill-used:'
const COMPLETE_SKILL_USED_MARKER = /^\[skill-used:([^\]\r\n]+)\][ \t]*(?:\r?\n)?/

function isPendingSkillUsedMarker(text: string): boolean {
  if (SKILL_USED_PREFIX.startsWith(text)) return text.length > 0
  return text.startsWith(SKILL_USED_PREFIX) && !text.includes(']')
}

/**
 * Extract leading skill-use control markers from an assistant response.
 *
 * Skills use these markers as a machine-readable signal that their instructions
 * were loaded. They are only interpreted at the start of a response so examples
 * in ordinary prose or code blocks continue to render verbatim.
 */
export function parseSkillUsedMarkers(
  text: string,
  isStreaming = false,
): ParsedSkillUsedContent {
  let content = text
  const skills: string[] = []
  const seenSkills = new Set<string>()

  while (true) {
    const leadingWhitespace = content.match(/^\s*/)?.[0] ?? ''
    const candidate = content.slice(leadingWhitespace.length)
    const marker = candidate.match(COMPLETE_SKILL_USED_MARKER)

    if (!marker) {
      const hasPendingMarker = isStreaming && isPendingSkillUsedMarker(candidate)
      return {
        content: hasPendingMarker ? '' : content,
        skills,
        hasPendingMarker,
      }
    }

    const skill = marker[1]?.trim()
    if (skill && !seenSkills.has(skill)) {
      seenSkills.add(skill)
      skills.push(skill)
    }

    content = candidate
      .slice(marker[0].length)
      .replace(/^(?:[ \t]*\r?\n)+/, '')
  }
}
