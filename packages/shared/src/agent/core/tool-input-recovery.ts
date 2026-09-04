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
  write: new Set(['path', 'content']),
};

const FIELD_ALIASES: Record<string, Readonly<Record<string, string>>> = {
  read: { file_path: 'path' },
  bash: { cmd: 'command' },
  write: { _content: 'content' },
};

/** Aliases that must stay strings. Wrong types are left for schema rejection. */
const STRING_ONLY_ALIASES: Record<string, ReadonlySet<string>> = {
  write: new Set(['_content']),
};

const PREVIEW_FENCE_TOOL_NAMES = new Set([
  'markdown-preview',
  'html-preview',
  'pdf-preview',
  'image-preview',
]);

export type ToolCompatEventKind = 'field_alias' | 'intent_markup' | 'preview_fence_tool_call';

export interface ToolCompatEvent {
  kind: ToolCompatEventKind;
  toolName: string;
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
}

export interface ToolInputRecoveryResult {
  input: Record<string, unknown>;
  recoveries: ToolCompatEvent[];
}

const toolCompatCounts = new Map<string, number>();

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

function aliasValueAllowed(toolName: string, alias: string, value: unknown): boolean {
  if (STRING_ONLY_ALIASES[toolName]?.has(alias)) return typeof value === 'string';
  return true;
}

export function toolCompatMetricKey(event: Pick<ToolCompatEvent, 'kind' | 'toolName' | 'provider' | 'model' | 'from' | 'to'>): string {
  return [
    event.kind,
    event.toolName,
    event.from ?? '-',
    event.to ?? '-',
    event.provider ?? '-',
    event.model ?? '-',
  ].join('|');
}

export function noteToolCompatEvent(event: ToolCompatEvent): { key: string; count: number } {
  const key = toolCompatMetricKey(event);
  const count = (toolCompatCounts.get(key) ?? 0) + 1;
  toolCompatCounts.set(key, count);
  return { key, count };
}

export function getToolCompatCounts(): Readonly<Record<string, number>> {
  return Object.fromEntries(toolCompatCounts);
}

export function resetToolCompatCounts(): void {
  toolCompatCounts.clear();
}

export function classifyPreviewFenceToolName(toolName: string): 'preview_fence_tool_call' | undefined {
  const normalized = toolName.trim().toLowerCase();
  return PREVIEW_FENCE_TOOL_NAMES.has(normalized) ? 'preview_fence_tool_call' : undefined;
}

export function noteAssistantPreviewFenceToolCalls(
  content: ReadonlyArray<{ type?: string; name?: string }>,
  context?: { provider?: string; model?: string },
): ToolCompatEvent[] {
  const noted: ToolCompatEvent[] = [];
  for (const block of content) {
    if (block.type !== 'toolCall' && block.type !== 'toolUse') continue;
    if (typeof block.name !== 'string') continue;
    const kind = classifyPreviewFenceToolName(block.name);
    if (!kind) continue;
    const event: ToolCompatEvent = {
      kind,
      toolName: block.name,
      provider: context?.provider,
      model: context?.model,
    };
    noteToolCompatEvent(event);
    noted.push(event);
  }
  return noted;
}

export function recoverKnownToolInput(
  toolName: string,
  input: Record<string, unknown>,
): ToolInputRecoveryResult {
  const normalizedToolName = toolName.toLowerCase();
  const allowed = RECOVERABLE_FIELDS[normalizedToolName];
  const aliases = FIELD_ALIASES[normalizedToolName] ?? {};
  const recoveries: ToolCompatEvent[] = [];
  let normalizedInput = input;
  for (const [alias, canonical] of Object.entries(aliases)) {
    const aliasValue = normalizedInput[alias];
    if (normalizedInput[canonical] !== undefined || aliasValue === undefined) continue;
    if (!aliasValueAllowed(normalizedToolName, alias, aliasValue)) continue;
    normalizedInput = { ...normalizedInput, [canonical]: aliasValue };
    delete normalizedInput[alias];
    recoveries.push({
      kind: 'field_alias',
      toolName: normalizedToolName,
      from: alias,
      to: canonical,
    });
  }
  const rawIntent = typeof input._intent === 'string' ? input._intent : undefined;
  if (!allowed || !rawIntent) return { input: normalizedInput, recoveries };
  const boundary = rawIntent.indexOf('</intent>');
  if (boundary < 0) return { input: normalizedInput, recoveries };
  const parsed = parseMarkupFragment(rawIntent.slice(boundary + '</intent>'.length));
  if (!parsed) return { input: normalizedInput, recoveries };

  const recovered: Record<string, unknown> = { ...normalizedInput, _intent: rawIntent.slice(0, boundary).trim() };
  for (const child of parsed.children) {
    const canonicalName = aliases[child.name] ?? child.name;
    if (!allowed.has(child.name) || recovered[canonicalName] !== undefined) continue;
    const value = nodeValue(child);
    if (!aliasValueAllowed(normalizedToolName, child.name, value)) continue;
    recovered[canonicalName] = canonicalName === 'timeout' && typeof value === 'string'
      ? Number(value)
      : value;
    recoveries.push({
      kind: 'intent_markup',
      toolName: normalizedToolName,
      from: child.name,
      to: canonicalName,
    });
  }
  return { input: recovered, recoveries };
}

export function recoverKnownToolInputFromIntent(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return recoverKnownToolInput(toolName, input).input;
}
