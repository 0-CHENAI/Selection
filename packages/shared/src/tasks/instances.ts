/** Stable execution instance id: `{nodeId}#{index}` for map/loop expansions. */
export function instanceId(nodeId: string, index: number): string {
  return `${nodeId}#${index}`;
}

export function definitionId(id: string): string {
  const i = id.indexOf('#');
  return i === -1 ? id : id.slice(0, i);
}

export function instanceIndex(id: string): number | null {
  const i = id.indexOf('#');
  if (i === -1) return null;
  const n = Number(id.slice(i + 1));
  return Number.isInteger(n) ? n : null;
}

function stringifyLocal(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Substitute map/loop locals that are not part of the ${nodes.*}/${params.*} grammar. */
export function interpolateLocals(
  template: string,
  locals: { item?: unknown; index?: number; prev?: string },
): string {
  return template
    .replace(/\$\{\s*item\s*\}/g, () => stringifyLocal(locals.item))
    .replace(/\$\{\s*index\s*\}/g, () => String(locals.index ?? ''))
    .replace(/\$\{\s*prev\s*\}/g, () => locals.prev ?? '');
}

/** Parse a resolved for_each string into an array. JSON arrays win; otherwise newline-split. */
export function parseForEach(resolved: string): unknown[] {
  const text = resolved.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    if (text.includes('\n')) return text.split('\n').map((s) => s.trim()).filter(Boolean);
    return [text];
  }
}
