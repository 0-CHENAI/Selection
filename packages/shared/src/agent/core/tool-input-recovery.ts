/**
 * Recover a narrow subset of XML-style tool arguments emitted by some
 * OpenAI-compatible providers. Recovered input still passes through normal
 * permissions and each tool's strict schema.
 */

interface MarkupNode {
  name: string;
  text: string;
  children: MarkupNode[];
}

const RECOVERABLE_FIELDS: Record<string, ReadonlySet<string>> = {
  read: new Set(['path', 'file_path']),
  bash: new Set(['command', 'cmd', 'timeout']),
};

const FIELD_ALIASES: Record<string, Readonly<Record<string, string>>> = {
  read: { file_path: 'path' },
  bash: { cmd: 'command' },
};

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseMarkupFragment(fragment: string): MarkupNode | null {
  if (fragment.length > 256 * 1024) return null;
  const root: MarkupNode = { name: 'root', text: '', children: [] };
  const stack = [root];
  const tags = /<\/?([A-Za-z][A-Za-z0-9_-]*)>/g;
  let cursor = 0;
  for (const match of fragment.matchAll(tags)) {
    const current = stack.at(-1)!;
    current.text += fragment.slice(cursor, match.index);
    const closing = match[0].startsWith('</');
    const name = match[1]!;
    if (closing) {
      if (stack.length === 1 || stack.at(-1)!.name !== name) return null;
      stack.pop();
    } else {
      if (stack.length > 12) return null;
      const child: MarkupNode = { name, text: '', children: [] };
      current.children.push(child);
      stack.push(child);
    }
    cursor = match.index + match[0].length;
  }
  stack.at(-1)!.text += fragment.slice(cursor);
  if (stack.length !== 1 || root.children.length === 0) return null;
  return root;
}

function nodeValue(node: MarkupNode): unknown {
  if (node.children.length === 0) {
    const value = decodeXmlText(node.text).trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (node.children.every(child => child.name === 'item')) {
    return node.children.map(nodeValue);
  }
  const result: Record<string, unknown> = {};
  for (const child of node.children) {
    const value = nodeValue(child);
    const existing = result[child.name];
    if (existing === undefined) result[child.name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[child.name] = [existing, value];
  }
  return result;
}

export function recoverKnownToolInputFromIntent(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedToolName = toolName.toLowerCase();
  const allowed = RECOVERABLE_FIELDS[normalizedToolName];
  const aliases = FIELD_ALIASES[normalizedToolName] ?? {};
  let normalizedInput = input;
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalizedInput[canonical] !== undefined || normalizedInput[alias] === undefined) continue;
    normalizedInput = { ...normalizedInput, [canonical]: normalizedInput[alias] };
    delete normalizedInput[alias];
  }
  const rawIntent = typeof input._intent === 'string' ? input._intent : undefined;
  if (!allowed || !rawIntent) return normalizedInput;
  const boundary = rawIntent.indexOf('</intent>');
  if (boundary < 0) return normalizedInput;
  const parsed = parseMarkupFragment(rawIntent.slice(boundary + '</intent>'.length));
  if (!parsed) return normalizedInput;

  const recovered: Record<string, unknown> = { ...normalizedInput, _intent: rawIntent.slice(0, boundary).trim() };
  for (const child of parsed.children) {
    const canonicalName = aliases[child.name] ?? child.name;
    if (!allowed.has(child.name) || recovered[canonicalName] !== undefined) continue;
    const value = nodeValue(child);
    recovered[canonicalName] = canonicalName === 'timeout' && typeof value === 'string'
      ? Number(value)
      : value;
  }
  return recovered;
}
