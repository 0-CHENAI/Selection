const MAX_SUMMARY_LENGTH = 30;

/** Version metadata is a short label; the delivered answer stays untouched. */
export function compactArtifactVersionSummary(value: string): string {
  const title = value.replace(/\s+/gu, ' ').trim().replace(/(?:…|\.{3})+$/u, '').trim();
  if (Array.from(title).length <= MAX_SUMMARY_LENGTH) return title;

  // Prefer the change itself over parenthetical layout details or later clauses.
  // Also handle a legacy title that was cut in the middle of its parentheses.
  const concise = title.replace(/（[^）]*(?:）|$)|\([^)]*(?:\)|$)/gu, '').replace(/\s+/gu, ' ').trim();
  const firstClause = concise.split(/[，,；;。！？!?]/u)[0]!.trim();
  if (firstClause.length >= 6 && Array.from(firstClause).length <= MAX_SUMMARY_LENGTH) return firstClause;
  if (Array.from(concise).length <= MAX_SUMMARY_LENGTH) return concise;

  const characters = Array.from(concise);
  let result = characters.slice(0, MAX_SUMMARY_LENGTH).join('').trim();
  // Keep Latin words intact when the limit falls inside a word.
  if (/[a-z\d]$/iu.test(result) && /^[a-z\d]/iu.test(characters[MAX_SUMMARY_LENGTH] ?? '')) {
    const boundary = result.lastIndexOf(' ');
    if (boundary >= 6) result = result.slice(0, boundary);
  }
  return result.replace(/[，,；;：:]$/u, '').trim();
}
