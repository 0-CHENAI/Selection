/**
 * Slugify utility for workspace names
 *
 * Converts a human-readable name into a filesystem-safe slug.
 * Example: "My Project" → "my-project"
 */

/**
 * Convert a string to a URL/filesystem-safe slug
 * - Lowercase ASCII letters
 * - Replace spaces and underscores with hyphens
 * - Keep Unicode letters/numbers (incl. Chinese) so CJK workspace names work as folder paths
 * - Collapse multiple hyphens
 * - Trim leading/trailing hyphens
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    // Replace spaces and underscores with hyphens
    .replace(/[\s_]+/g, '-')
    // Keep letters (any language), numbers, and hyphens — strip path-hostile chars
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    // Collapse multiple hyphens into one
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-|-$/g, '')
}

/**
 * Check if a string is a valid slug (already slugified)
 * Allows Unicode letters/numbers for CJK folder names.
 */
export function isValidSlug(str: string): boolean {
  return /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(str)
}
