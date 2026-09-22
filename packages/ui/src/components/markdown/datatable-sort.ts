const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const CHINESE_NUMERAL = /[零〇一二两三四五六七八九十百千万亿]/

/** Read a Chinese numeral such as 十, 十二, or 二十三. */
function parseChineseInteger(value: string): number | null {
  if (!value || !CHINESE_NUMERAL.test(value)) return null
  let total = 0
  let current = 0
  let seen = false
  for (const char of value) {
    const digit = CHINESE_DIGITS[char]
    if (digit !== undefined) {
      current = digit
      seen = true
      continue
    }
    const unit = char === '十' ? 10
      : char === '百' ? 100
      : char === '千' ? 1_000
      : char === '万' ? 10_000
      : char === '亿' ? 100_000_000
      : 0
    if (!unit) return null
    if (unit >= 10_000) {
      total = (total + (current || (seen ? 0 : 1))) * unit
      current = 0
    } else {
      total += (current || 1) * unit
      current = 0
    }
    seen = true
  }
  return seen ? total + current : null
}

function leadingSortNumber(value: string): number | null {
  const text = value.trim()
  const arabic = /^(?:第\s*)?(\d+)/.exec(text)
  if (arabic) return Number(arabic[1])
  const chinese = /^(?:第\s*)?([零〇一二两三四五六七八九十百千万亿]+)/.exec(text)
  return chinese ? parseChineseInteger(chinese[1]!) : null
}

function cellSortText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * A column is sortable only when it has at least two distinct values and those
 * values are short comparable data, not long prose.
 */
export function isDatatableColumnSortable(values: unknown[]): boolean {
  const present = values.map(cellSortText).filter(Boolean)
  if (new Set(present).size < 2) return false
  const longProse = present.filter(value => value.length > 40 || /[。！？.!?；;]/.test(value))
  return longProse.length <= present.length / 2
}

/** Compare table text with numeric and Chinese-numeral order. */
export function compareDatatableText(left: string, right: string): number {
  const leftNumber = leadingSortNumber(left)
  const rightNumber = leadingSortNumber(right)
  if (leftNumber !== null || rightNumber !== null) {
    if (leftNumber === null) return 1
    if (rightNumber === null) return -1
    if (leftNumber !== rightNumber) return leftNumber - rightNumber
  }
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}
