/**
 * Shared remark-math configuration for chat markdown.
 *
 * Single-dollar `$...$` is enabled so `$A$` / `$E=mc^2$` become inline math.
 * Currency-like `$` is escaped first via {@link protectCurrencyDollars}
 * so `$100` and `$2M–$4M` stay plain text.
 */
export const MARKDOWN_MATH_OPTIONS = {
  singleDollarTextMath: true,
} as const

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashes += 1
  }
  return slashes % 2 === 1
}

function indexOfUnescaped(text: string, token: string, from: number): number {
  let index = from
  while (index < text.length) {
    const found = text.indexOf(token, index)
    if (found === -1) return -1
    if (!isEscaped(text, found)) return found
    index = found + token.length
  }
  return -1
}

/**
 * Ranges that must keep their `$` characters untouched: fenced code,
 * inline code, and `$$...$$` (including an unclosed opener at EOF so
 * streaming display math is not rewritten mid-fence).
 */
function findProtectedDollarRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let i = 0

  while (i < text.length) {
    if (text.startsWith('```', i)) {
      const close = text.indexOf('```', i + 3)
      const end = close === -1 ? text.length : close + 3
      ranges.push({ start: i, end })
      i = end
      continue
    }

    if (text.startsWith('$$', i) && !isEscaped(text, i)) {
      const close = indexOfUnescaped(text, '$$', i + 2)
      const end = close === -1 ? text.length : close + 2
      ranges.push({ start: i, end })
      i = end
      continue
    }

    if (text[i] === '`' && !isEscaped(text, i)) {
      const close = text.indexOf('`', i + 1)
      if (close !== -1) {
        ranges.push({ start: i, end: close + 1 })
        i = close + 1
        continue
      }
    }

    i += 1
  }

  return ranges
}

/**
 * Escape `$` that start a currency amount so remark-math will not pair
 * them as `$...$`. Leaves `$A$`, `$E=mc^2$`, `$P(H_3\mid A_1)$`, and
 * protected ranges alone.
 */
export function protectCurrencyDollars(markdown: string): string {
  if (!markdown.includes('$')) return markdown

  const protectedRanges = findProtectedDollarRanges(markdown)
  let result = ''
  let rangeIndex = 0

  for (let i = 0; i < markdown.length; i += 1) {
    while (rangeIndex < protectedRanges.length && i >= (protectedRanges[rangeIndex]?.end ?? 0)) {
      rangeIndex += 1
    }
    const currentRange = protectedRanges[rangeIndex]
    const inProtected = currentRange != null && i >= currentRange.start && i < currentRange.end
    const char = markdown[i]
    const next = markdown[i + 1]

    if (
      char === '$' &&
      next !== undefined &&
      next >= '0' &&
      next <= '9' &&
      !isEscaped(markdown, i) &&
      !inProtected
    ) {
      result += '\\$'
      continue
    }

    result += char
  }

  return result
}
