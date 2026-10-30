import { pythonFloatLiteral } from './python-number.ts'

export type PyJson =
  | null
  | string
  | { t: 'int'; n: number }
  | { t: 'float'; n: number }
  | { t: 'obj'; entries: ReadonlyArray<readonly [string, PyJson]> }

/** CPython json.dumps(..., indent=2) 再加 print 的换行。ensure_ascii=True。 */
export function pythonJsonStdout(value: PyJson): string {
  return `${dump(value, 0)}\n`
}

function dump(value: PyJson, level: number): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return escapeString(value)
  if (value.t === 'int') return String(value.n)
  if (value.t === 'float') return pythonFloatLiteral(value.n)
  const pad = ' '.repeat((level + 1) * 2)
  const close = ' '.repeat(level * 2)
  const lines = value.entries.map(([key, child]) => `${pad}${escapeString(key)}: ${dump(child, level + 1)}`)
  return `{\n${lines.join(',\n')}\n${close}}`
}

function escapeString(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code > 0x7e) out += unicodeEscape(code)
    else out += ch
  }
  return `${out}"`
}

function unicodeEscape(code: number): string {
  if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, '0')}`
  const rest = code - 0x10000
  const high = 0xd800 + (rest >> 10)
  const low = 0xdc00 + (rest & 0x3ff)
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
}
