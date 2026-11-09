export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

const FLOAT = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i

export function takeFlag(argv: readonly string[], name: string): { value?: string; rest: string[]; present: boolean; error?: string } {
  const rest: string[] = []
  let value: string | undefined
  let present = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (token === name || token.startsWith(`${name}=`)) {
      present = true
      const raw = token === name ? argv[index + 1] : token.slice(name.length + 1)
      if (token === name) index += 1
      if (raw === undefined) return { rest, present, error: `${name} requires a value` }
      value = raw
      continue
    }
    rest.push(token)
  }
  return { value, rest, present }
}

export function parseFloatFlag(raw: string): number | null {
  const text = raw.trim()
  if (!FLOAT.test(text)) return null
  const lower = text.toLowerCase()
  if (lower === 'nan' || lower === '+nan' || lower === '-nan') return Number.NaN
  if (lower === 'inf' || lower === '+inf' || lower === 'infinity' || lower === '+infinity') return Infinity
  if (lower === '-inf' || lower === '-infinity') return -Infinity
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function parseIntFlag(raw: string): number | null {
  if (!/^[+-]?\d+$/.test(raw.trim())) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export function hasFlag(argv: readonly string[], name: string): { present: boolean; rest: string[] } {
  return { present: argv.includes(name), rest: argv.filter(token => token !== name) }
}

export function scalePercent(value: number): number {
  return value > 1 ? value / 100 : value
}
