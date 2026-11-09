/**
 * Keeps passwords entered with browser_tool (`fill`, and `type`/`paste` into a password field)
 * out of stored tool inputs.
 *
 * Whether a field holds a password is known only after the fill, so the call input still
 * carries the value. The runtime's result names each password field it filled
 * (PASSWORD_FILL_MARKER). When page metrics are missing it names the fill instead
 * (UNCONFIRMED_FILL_MARKER), because the value cannot be shown to be safe. The session
 * layer then replaces the value in its stored copy of the input with a placeholder.
 * Pi's own transcript is append-only and already contains the tool call before the
 * result exists, so this does not rewrite that history.
 */

import { isCanonicalBrowserToolName } from './browser-tool-names.ts';
import { PASSWORD_FILL_MARKER, PASSWORD_TEXT_MARKER, UNCONFIRMED_FILL_MARKER, UNCONFIRMED_TEXT_MARKER, splitBatchCommands, tokenizeCommand } from './browser-tool-runtime.ts';

// Not anchored to line starts: Claude stores an MCP tool result as JSON text blocks, where the
// output's line breaks are escaped.
const PASSWORD_FILL_REF = new RegExp(`${PASSWORD_FILL_MARKER} (\\S+)`, 'g');
const UNCONFIRMED_FILL_REF = new RegExp(`${UNCONFIRMED_FILL_MARKER} (\\S+)`, 'g');

const VALUE_PLACEHOLDER = /^\[(?:password|redacted): \d+ characters\]$/;

function valuePlaceholder(kind: 'password' | 'redacted', length: number): string {
  return `[${kind}: ${length} characters]`;
}

/** Refs of the password fields a browser_tool result reports as filled. */
export function passwordFillRefs(result: string): string[] {
  return [...new Set(Array.from(result.matchAll(PASSWORD_FILL_REF), (match) => match[1]!))];
}

/** Refs of fills whose page metrics did not say whether the field was a password. */
export function unconfirmedFillRefs(result: string): string[] {
  return [...new Set(Array.from(result.matchAll(UNCONFIRMED_FILL_REF), (match) => match[1]!))];
}

/** What a result says went into fields that must not keep their typed value. */
interface SecretEntries {
  refs: ReadonlySet<string>;
  unconfirmedRefs: ReadonlySet<string>;
  typedText: boolean;
  unconfirmedText: boolean;
}

/**
 * For a command that put a secret into a field (`fill <ref> <value>` into one of the refs, or any
 * `type`/`paste` when a typed text went into a password field): how many words precede the value
 * and the value's placeholder. Undefined for any other command, and for a value that is already a
 * placeholder (results can arrive twice).
 */
function secretValue(parts: readonly unknown[], secrets: SecretEntries): { headWords: number; placeholder: string } | undefined {
  const verb = typeof parts[0] === 'string' ? parts[0].toLowerCase() : undefined;
  let headWords: number;
  let kind: 'password' | 'redacted';
  if (verb === 'fill') {
    const ref = parts[1];
    if (typeof ref !== 'string' || parts.length < 3) return undefined;
    if (secrets.refs.has(ref)) kind = 'password';
    else if (secrets.unconfirmedRefs.has(ref)) kind = 'redacted';
    else return undefined;
    headWords = 2;
  } else if (verb === 'type' || verb === 'paste') {
    if (parts.length < 2) return undefined;
    if (secrets.typedText) kind = 'password';
    else if (secrets.unconfirmedText) kind = 'redacted';
    else return undefined;
    headWords = 1;
  } else {
    return undefined;
  }
  // The runtime enters the remaining parts joined by spaces.
  const value = parts.slice(headWords).join(' ');
  return VALUE_PLACEHOLDER.test(value) ? undefined : { headWords, placeholder: valuePlaceholder(kind, value.length) };
}

/**
 * A command as written up to its value: the text before the first word boundary whose prefix the
 * runtime's tokenizer reads as just the leading `headWords` words.
 */
function commandHead(command: string, tokens: readonly string[], headWords: number): string {
  for (let i = 1; i < command.length; i += 1) {
    if (!/\s/.test(command[i - 1]!) || /\s/.test(command[i]!)) continue;
    try {
      const head = tokenizeCommand(command.slice(0, i));
      if (head.length === headWords && head.every((word, index) => word === tokens[index])) return command.slice(0, i);
    } catch {
      // The boundary is inside a quoted span.
    }
  }
  return `${tokens.slice(0, headWords).join(' ')} `;
}

function redactCommandString(command: string, secrets: SecretEntries): string {
  let commands: string[];
  try {
    commands = splitBatchCommands(command.trim());
  } catch {
    return command; // The runtime rejects it too, so nothing was filled.
  }

  let redacted = '';
  let copied = 0;
  let searchFrom = 0;
  for (const part of commands) {
    // Batch commands are verbatim slices of the input, so the text around them is kept as written.
    const start = command.indexOf(part, searchFrom);
    searchFrom = start + part.length;
    let tokens: string[];
    try {
      tokens = tokenizeCommand(part);
    } catch {
      continue;
    }
    const secret = secretValue(tokens, secrets);
    if (secret === undefined) continue;
    redacted += command.slice(copied, start) + commandHead(part, tokens, secret.headWords) + secret.placeholder;
    copied = searchFrom;
  }
  return copied === 0 ? command : redacted + command.slice(copied);
}

/**
 * `input` with the value of every `fill <ref> <value>` into one of `refs` replaced by a
 * placeholder, and with `typedText` the text of every `type`/`paste` too, for the string (also
 * batched) and array forms of `command`. Commands are read with the runtime's own parser; `input`
 * itself is returned when nothing changes.
 */
export function redactBrowserToolInput(
  input: Record<string, unknown>,
  refs: readonly string[],
  options: { typedText?: boolean; unconfirmedRefs?: readonly string[]; unconfirmedText?: boolean } = {},
): Record<string, unknown> {
  const secrets: SecretEntries = {
    refs: new Set(refs),
    unconfirmedRefs: new Set(options.unconfirmedRefs ?? []),
    typedText: !!options.typedText,
    unconfirmedText: !!options.unconfirmedText,
  };
  const { command } = input;
  if (secrets.refs.size === 0 && secrets.unconfirmedRefs.size === 0 && !secrets.typedText && !secrets.unconfirmedText) return input;
  if (typeof command === 'string') {
    const redacted = redactCommandString(command, secrets);
    return redacted === command ? input : { ...input, command: redacted };
  }
  if (Array.isArray(command)) {
    // Array mode runs as one command, without batch splitting or tokenizing.
    const secret = secretValue(command, secrets);
    return secret === undefined ? input : { ...input, command: [...command.slice(0, secret.headWords), secret.placeholder] };
  }
  return input;
}

/**
 * `replacement` for a browser_tool result (e.g. the session's media summary of a screenshot
 * batch) with the original's password-entry lines kept, so its stored input can still be redacted.
 */
export function keepPasswordEntryLines(original: string, replacement: string): string {
  const lines = [
    ...passwordFillRefs(original).map((ref) => `${PASSWORD_FILL_MARKER} ${ref}`),
    ...unconfirmedFillRefs(original).map((ref) => `${UNCONFIRMED_FILL_MARKER} ${ref}`),
  ];
  if (original.includes(PASSWORD_TEXT_MARKER)) lines.push(PASSWORD_TEXT_MARKER);
  if (original.includes(UNCONFIRMED_TEXT_MARKER)) lines.push(UNCONFIRMED_TEXT_MARKER);
  return lines.length > 0 ? `${replacement}\n\n${lines.join('\n')}` : replacement;
}

/**
 * The input of a finished browser_tool call with the values of the password fills its result
 * reports replaced, or undefined when there is nothing to redact.
 */
export function redactBrowserPasswordFills(
  toolName: string,
  input: Record<string, unknown> | undefined,
  result: string | undefined,
): Record<string, unknown> | undefined {
  if (!input || !result || !isCanonicalBrowserToolName(toolName)) return undefined;
  const refs = passwordFillRefs(result);
  const unconfirmedRefs = unconfirmedFillRefs(result);
  const typedText = result.includes(PASSWORD_TEXT_MARKER);
  const unconfirmedText = result.includes(UNCONFIRMED_TEXT_MARKER);
  if (refs.length === 0 && unconfirmedRefs.length === 0 && !typedText && !unconfirmedText) return undefined;
  const redacted = redactBrowserToolInput(input, refs, { typedText, unconfirmedRefs, unconfirmedText });
  return redacted === input ? undefined : redacted;
}
