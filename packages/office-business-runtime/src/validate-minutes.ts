/**
 * 会议纪要结构校验。行为对齐 dsh meeting-recap `validate_minutes.py`
 * （588412b，sha256 cca5ddea85bb07a64a93b012393b62ebc92777ec0cbb9c7638cbeb5ea38cc720）。
 * 事实是否忠实于原始记录不在这里判断。
 */

export interface MinutesReport {
  passed: boolean
  errors: string[]
  warnings: string[]
  info: string[]
  text: string
  exitCode: number
}

function finish(errors: string[], warnings: string[], info: string[]): MinutesReport {
  const passed = errors.length === 0
  const lines = [`会议纪要结构校验：${passed ? '通过' : '需修正'}`]
  const groups: Array<[string, string[]]> = [
    ['错误', errors],
    ['待确认', warnings],
    ['信息', info],
  ]
  for (const [kind, items] of groups) {
    for (const item of items) lines.push(`${kind}：${item}`)
  }
  return { passed, errors, warnings, info, text: lines.join('\n'), exitCode: passed ? 0 : 1 }
}

function section(content: string, names: readonly string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^##\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm')
    const match = pattern.exec(content)
    if (match) return match[1] ?? ''
  }
  return null
}

function cells(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  return value.split('|').map(cell => cell.trim())
}

function isPythonWord(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char)
}

/** Python 3 的 `\b` 按 Unicode 词字符判断，中文与数字之间没有边界。 */
function pythonDates(text: string): string[] {
  const found: string[] = []
  const pattern = /\d{4}-\d{2}-\d{2}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const start = match.index
    const end = start + match[0].length
    const before = start === 0 ? '' : text[start - 1] ?? ''
    const after = end >= text.length ? '' : text[end] ?? ''
    const left = before === '' || !isPythonWord(before)
    const right = after === '' || !isPythonWord(after)
    if (left && right) found.push(match[0])
  }
  return found
}

function isoDateOk(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function validateMinutes(content: string): MinutesReport {
  const errors: string[] = []
  const warnings: string[] = []
  const info: string[] = []
  if (!/^#\s+.*会议纪要/m.test(content)) errors.push('主标题应包含会议纪要')
  const topics = section(content, ['议题记录', '详细记录'])
  if (topics === null || topics.trim() === '') errors.push('请提供议题记录及明确的事项状态')
  const actions = section(content, ['行动项', '行动项汇总'])
  if (actions === null || actions.trim() === '') {
    errors.push('请列出行动项，或记录本次明确没有新增任务')
    return finish(errors, warnings, info)
  }
  const table = actions.split('\n').filter(line => line.trim().startsWith('|')).map(cells)
  if (table.length > 0) {
    const header = table[0] ?? []
    const aliases = [
      ['任务', '任务描述', '事项'],
      ['负责人'],
      ['期限', '截止日期'],
      ['交付标准', '完成标准', '交付物'],
    ] as const
    const positions: Array<number | null> = []
    for (const labels of aliases) {
      const index = header.findIndex(value => (labels as readonly string[]).includes(value))
      if (index < 0) errors.push(`行动项表需包含${labels[0]}`)
      positions.push(index < 0 ? null : index)
    }
    if (positions.every(index => index !== null)) {
      const seen = new Set<string>()
      let count = 0
      for (const row of table.slice(1)) {
        if (row.every(value => /^:?-+:?$/.test(value.replace(/ /g, '')))) continue
        if (row.length !== header.length) {
          errors.push('行动项列数与表头一致')
          continue
        }
        count += 1
        const values = positions.map(index => row[index ?? 0] ?? '')
        if (values.some(value => value.length === 0)) errors.push('行动项缺失字段请标为待确认')
        const task = values[0] ?? ''
        const deadline = values[2] ?? ''
        const identity = task.replace(/\s+/g, '')
        if (seen.has(identity)) errors.push(`重复任务请合并：${task}`)
        seen.add(identity)
        if (values.some(value => value.includes('待确认'))) warnings.push(`${task}有待确认字段`)
        for (const value of pythonDates(deadline)) {
          if (!isoDateOk(value)) errors.push(`请核对期限中的日期：${value}`)
        }
      }
      if (count === 0) errors.push('请填写行动项，或用正文记录本次明确没有新增任务')
      info.push(`行动项数量：${count}`)
    }
  }
  return finish(errors, warnings, info)
}
