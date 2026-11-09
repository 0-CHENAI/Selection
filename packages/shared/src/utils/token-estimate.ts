/** Conservative token estimate shared by request admission and tool-result spill. */
const DENSITY_AWARE_MIN_LENGTH = 20_000;
const BASE64_RUN_MIN = 60;
const BASE64_DENSITY_THRESHOLD = 0.70;
const BASE64_CHARS_PER_TOKEN = 1.5;

export function estimateTokensDensityAware(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii++;
    else nonAscii++;
  }
  const mixedLanguageEstimate = Math.ceil(ascii / 4) + nonAscii;
  if (text.length < DENSITY_AWARE_MIN_LENGTH) return mixedLanguageEstimate;

  // MIME and PEM line wrapping must count too, not only one long base64 run.
  const runRegex = new RegExp(`[A-Za-z0-9+/=]{${BASE64_RUN_MIN},}`, 'g');
  let denseChars = 0;
  for (const match of text.matchAll(runRegex)) denseChars += match[0].length;
  return denseChars / text.length >= BASE64_DENSITY_THRESHOLD
    ? Math.max(mixedLanguageEstimate, Math.ceil(text.length / BASE64_CHARS_PER_TOKEN))
    : mixedLanguageEstimate;
}
