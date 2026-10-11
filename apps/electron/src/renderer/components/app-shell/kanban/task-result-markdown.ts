// Legacy summaries can contain literal \n instead of line breaks. Repair only
// single-line reports with clear paragraph/block separators, without changing
// stored outputs, normal Markdown, code literals, link targets or file paths.
const protectedLiteral = /(`+)[\s\S]*?\1|(?:[A-Za-z]:\\|\\\\)[^\s]+|\]\([^)]*\)/g
const escapedBlockBreak = /(?<!\\)\\(?:r\\)?n(?=\\(?:r\\)?n|[ \t]*(?:#{1,6}[ \t]|[-*+>][ \t]|\d+[.)][ \t]|\|))/

export function taskResultMarkdown(text: string): string {
  if (/[\r\n]/.test(text)) return text
  if (!escapedBlockBreak.test(text.replace(protectedLiteral, ''))) return text
  // Structured JSON may intentionally describe strings containing escapes.
  try { JSON.parse(text); return text } catch { /* prose, not a JSON document */ }
  const tokens = new RegExp(protectedLiteral.source + '|(?<!\\\\)\\\\r\\\\n|(?<!\\\\)\\\\n', 'g')
  return text.replace(tokens, token => token === '\\n' || token === '\\r\\n' ? '\n' : token)
}
