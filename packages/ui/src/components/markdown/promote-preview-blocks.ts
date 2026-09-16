import { parseMarkdownPreviewSpec } from './markdown-preview-helpers'

const PREVIEW_NAMES = 'image-preview|html-preview|pdf-preview|markdown-preview'

function findFencedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const fence = /```[\s\S]*?```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function extractBalancedJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Models often emit `image-preview` + JSON without wrapping fences.
 * Promote those bare specs into ```image-preview fences so the existing
 * preview renderers can load the file instead of showing raw JSON.
 */
export function promoteBarePreviewBlocks(text: string): string {
  const fences = findFencedRanges(text)
  const nameRe = new RegExp(`(^|\\n)(${PREVIEW_NAMES})[ \\t]*\\n[ \\t]*\\{`, 'g')
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = nameRe.exec(text)) !== null) {
    const prefix = match[1] ?? ''
    const name = match[2]
    if (!name) continue

    const keywordStart = match.index + prefix.length
    if (fences.some((range) => keywordStart >= range.start && keywordStart < range.end)) {
      continue
    }

    const braceStart = text.indexOf('{', keywordStart)
    const json = braceStart >= 0 ? extractBalancedJsonObject(text, braceStart) : null
    if (!json || !parseMarkdownPreviewSpec(json)) continue

    result += text.slice(lastIndex, keywordStart)
    result += `\`\`\`${name}\n${json}\n\`\`\``
    lastIndex = braceStart + json.length
    nameRe.lastIndex = lastIndex
  }

  return result + text.slice(lastIndex)
}
