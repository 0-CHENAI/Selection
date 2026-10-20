/**
 * Provider reasoning (DeepSeek reasoning_content, Pi thinking blocks) is never
 * the reply. The `__think` sub-turn is the historical marker; `streamKind`
 * is the explicit kind so a legacy/unclassified phase cannot promote it.
 */
export function isThinkingText(input: { streamKind?: 'thinking'; turnId?: string } | undefined): boolean {
  return input?.streamKind === 'thinking' || !!input?.turnId?.includes('__think')
}
