/**
 * 与 CPython 3.12 的 round / format / json 数值写法对齐。
 * 只覆盖本运行时实际产出的有限数值；不在 CI 里调用 Python。
 */

export function pythonFixed(value: number, ndigits: number): string {
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  if (abs === 0) {
    const frac = ndigits > 0 ? `.${'0'.repeat(ndigits)}` : ''
    return `${Object.is(value, -0) ? '-' : ''}0${frac}`
  }
  const { mantissa, exponent } = decompose(abs)
  const ten = 10n ** BigInt(ndigits)
  let numerator = mantissa * ten
  let denominator = 1n
  if (exponent >= 0) numerator <<= BigInt(exponent)
  else denominator <<= BigInt(-exponent)
  const scaled = divRoundHalfEven(numerator, denominator)
  let digits = scaled.toString()
  const prefix = sign < 0 ? '-' : ''
  if (ndigits === 0) return prefix + digits
  if (digits.length <= ndigits) digits = digits.padStart(ndigits + 1, '0')
  const cut = digits.length - ndigits
  return `${prefix}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

export function pythonRound(value: number, ndigits: number): number {
  return Number(pythonFixed(value, ndigits))
}

/** CPython json.dumps 对 float 的字面量。整数形态写成 1.0。 */
export function pythonFloatLiteral(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  if (Object.is(value, -0)) return '-0.0'
  if (value === 0) return '0.0'
  const negative = value < 0
  let body = Math.abs(value).toString()
  if (!/[eE.]/.test(body)) body += '.0'
  return negative ? `-${body}` : body
}

function decompose(value: number): { mantissa: bigint; exponent: number } {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setFloat64(0, value)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const expBits = (hi >>> 20) & 0x7ff
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  if (expBits === 0) return { mantissa: frac, exponent: -1022 - 52 }
  return { mantissa: frac | (1n << 52n), exponent: expBits - 1023 - 52 }
}

function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const twice = remainder * 2n
  if (twice > denominator) return quotient + 1n
  if (twice < denominator) return quotient
  return (quotient & 1n) === 0n ? quotient : quotient + 1n
}
