export function formatUsageDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

export function formatUsageCost(costUsd: number): string {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return '$0.00'
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`
  return `$${costUsd.toFixed(2)}`
}
