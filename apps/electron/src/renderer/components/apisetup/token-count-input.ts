/** Match existing token presets: 1K = 1024, 1M = 1024². */
export function parseTokenCount(input: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(input)
  if (!match) return undefined
  const multiplier = match[2]?.toLowerCase() === 'm' ? 1024 ** 2 : match[2]?.toLowerCase() === 'k' ? 1024 : 1
  const value = Number(match[1]) * multiplier
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function formatTokenInput(value: number): string {
  return value % 1024 === 0 ? `${value / 1024}K` : String(value)
}
