export function mergeSummarizedToolResult<T extends { type: string }>(
  summarizedText: string,
  originalContent: readonly T[],
): Array<{ type: 'text'; text: string } | T> {
  const images = originalContent.filter(part => part.type === 'image')
  return [{ type: 'text', text: summarizedText }, ...images]
}
