/**
 * Office document workflow — single source of playbook copy, tool
 * descriptions, inspect-budget constants, and file fingerprints.
 */

import { isAbsolute, join, normalize } from 'node:path';

export const OFFICE_INSPECT_BUDGET_LIMIT = 4;

const OFFICE_BUDGET_RESETTING_EDIT_COMMANDS: ReadonlySet<string> = new Set([
  'create', 'set', 'add', 'remove', 'move', 'swap',
  'raw-set', 'add-part', 'batch', 'import', 'merge',
]);

export const OFFICE_INSPECT_COUNTED_COMMANDS: ReadonlySet<string> = new Set([
  'view', 'get', 'query', 'validate', 'dump', 'raw',
]);

export const OFFICE_TRUNCATED_PREVIEW_CHARS = 800;

export const OFFICE_TRUNCATION_SUGGESTION =
  'Output was truncated. Use view outline, query, or get for a narrower read. Do not dump or raw the whole tree.';

export const OFFICE_REFRESH_NON_WINDOWS_NOTE =
  'DOCX refresh requires Word + Windows. If TOC or field values remain placeholders, deliver the file and ask the user to update fields in Word.';

export const OFFICE_ALREADY_CHECKED_MESSAGE =
  'This inspect command was already run for this file. Deliver from the previous result.';

export const OFFICE_ALREADY_CHECKED_SUGGESTION =
  'Do not retry the same inspect or switch commands to re-prove the same fact. Deliver the file path, what is done, and any platform limits.';

export const OFFICE_BUDGET_EXHAUSTED_MESSAGE =
  'Inspect budget exhausted for this file. Deliver now.';

export const OFFICE_BUDGET_EXHAUSTED_SUGGESTION =
  'Stop inspecting. Reply with the file path, completed work, and what this backend could not verify (TOC page numbers, visual style).';

export const OFFICE_MAX_INLINE_BATCH_COMMANDS = 30;
export const OFFICE_MAX_INLINE_BATCH_CHARS = 16_000;
export const OFFICE_MAX_INLINE_ARGUMENTS_CHARS = 8_000;
export const OFFICE_MAX_BATCH_FILE_BYTES = 2_000_000;

export const OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION =
  'Do not retry the same payload. Write the command array as JSON, then call batch with batchCommandsFile; or split into smaller in-limit batches.';

const OFFICE_WORKFLOW_GENERATE_RULES = `- Generate (small/medium): create a blank file, then one inline batch (headings, paragraphs, tables, TOC fields) within ${OFFICE_MAX_INLINE_BATCH_COMMANDS} commands and ${OFFICE_MAX_INLINE_BATCH_CHARS} characters. Fill a template with merge. Do not draft long Markdown and add it paragraph by paragraph. If an element is unclear, call help docx heading or help docx add paragraph — do not dump XML.
- Generate (large): prefer multiple in-limit batches over one giant tool call. If the command array fits in one Write but not in batchCommands, Write a .json file in the working directory, then batch with batchCommandsFile. Do not put multi-page text in batchCommands or --prop. If a tool call fails because the payload is too large or arguments were truncated, do not retry the same payload — write a smaller file or split into smaller batches.`;

const OFFICE_WORKFLOW_INSPECT_RULES = `- Read: start with view outline or view text --max-lines 80. Use get or query only for a single node.
- Validate: after generating, at most one validate (OpenXML schema only). If the body is present and schema passes, deliver.
- Do not: treat dump as a reader — dump only prepares a replayable batch. raw is a last resort. Do not switch inspect commands to re-prove the same fact. view issues field_not_evaluated is common off Windows — state the limit and deliver; do not refresh or dump again.
- refresh: DOCX TOC/page numbers update only with Word + Windows. If that is unavailable, tell the user to open the file in Word and update fields, then stop.
- Closing reply: file path, what is done, what this backend could not verify (TOC page numbers, visual style), and one Word step for the user.`;

export const OFFICE_WORKFLOW_PROMPT = `Office document workflow (follow this; do not explore):
${OFFICE_WORKFLOW_GENERATE_RULES}
${OFFICE_WORKFLOW_INSPECT_RULES}`;

export const OFFICE_DOCUMENT_INSPECT_DESCRIPTION = `Inspect Word, Excel, and PowerPoint files through Selection's built-in OfficeCLI runtime.

This tool is always registered and does not require loading a skill. It accepts argument tokens, invokes the app-managed binary directly, and returns normalized JSON.

Office document workflow (follow this; do not explore):
${OFFICE_WORKFLOW_INSPECT_RULES}

Examples:
- Check availability: { "command": "status" }
- Read a document: { "command": "view", "arguments": ["report.docx", "outline"] }
- Validate a workbook: { "command": "validate", "arguments": ["data.xlsx"] }
- Get help: { "command": "help", "arguments": ["docx", "heading"] }

The read-only tool rejects output files, browser launching, and JSONL output. Use office_document_edit for mutations.`;

export const OFFICE_DOCUMENT_EDIT_DESCRIPTION = `Create and modify Word, Excel, and PowerPoint files through Selection's built-in OfficeCLI runtime.

This tool is always registered and does not require loading a skill. Arguments are passed as separate tokens without a shell, and results use a stable JSON envelope. Batch calls must use exactly one of batchCommands (small/medium, max ${OFFICE_MAX_INLINE_BATCH_COMMANDS} commands / ${OFFICE_MAX_INLINE_BATCH_CHARS} characters) or batchCommandsFile (large JSON written first). Resident and management commands are not accepted.

${OFFICE_WORKFLOW_PROMPT}

Examples:
- Create: { "command": "create", "arguments": ["report.docx"] }
- Add paragraph: { "command": "add", "arguments": ["report.docx", "/body", "--type", "paragraph", "--prop", "text=Summary"] }
- Small batch: { "command": "batch", "arguments": ["data.xlsx"], "batchCommands": [{ "command": "set", "path": "/Sheet1/A1", "props": { "value": "Done" } }] }
- Large batch: Write commands.json first, then { "command": "batch", "arguments": ["report.docx"], "batchCommandsFile": "commands.json" }

After a successful edit, at most one focused office_document_inspect (outline, short text, or a single validate), then deliver. Do not keep validating the result.`;

export function isOfficeInspectCountedCommand(command: string): boolean {
  return OFFICE_INSPECT_COUNTED_COMMANDS.has(command);
}

export function isOfficeBudgetResettingEdit(command: string): boolean {
  return OFFICE_BUDGET_RESETTING_EDIT_COMMANDS.has(command);
}

export function isOfficeDocxPath(filePath: string | undefined): boolean {
  return typeof filePath === 'string' && /\.docx$/i.test(filePath);
}

export function normalizeOfficeArgument(argument: string): string {
  const trimmed = argument.trim();
  if (trimmed.startsWith('-')) return trimmed;
  return normalize(trimmed).replaceAll('\\', '/');
}

function looksLikeOfficeDocumentPath(argument: string): boolean {
  return /\.(?:docx|xlsx|pptx)$/i.test(argument);
}

export function resolveOfficeDocumentPath(
  argumentList: string[] | undefined,
  cwd?: string,
): string | undefined {
  const pathArg = (argumentList ?? []).find(argument => {
    const trimmed = argument.trim();
    return trimmed.length > 0 && !trimmed.startsWith('-') && looksLikeOfficeDocumentPath(trimmed);
  });
  if (pathArg === undefined) return undefined;
  const normalized = normalizeOfficeArgument(pathArg);
  if (!cwd || isAbsolute(normalized)) return normalized;
  return normalizeOfficeArgument(join(cwd, normalized));
}

export function extractOfficeDocumentPath(argumentList: string[] | undefined): string | undefined {
  return resolveOfficeDocumentPath(argumentList);
}

export function normalizeOfficeInspectArguments(
  argumentList: string[] | undefined,
  cwd?: string,
): string[] {
  return (argumentList ?? []).map(argument => {
    const trimmed = argument.trim();
    if (trimmed.length === 0 || trimmed.startsWith('-') || !looksLikeOfficeDocumentPath(trimmed)) {
      return normalizeOfficeArgument(argument);
    }
    return resolveOfficeDocumentPath([argument], cwd) ?? normalizeOfficeArgument(argument);
  });
}

export function officeInspectFingerprint(
  command: string,
  argumentList: string[] | undefined,
  cwd?: string,
): string {
  return `${command}\0${JSON.stringify(normalizeOfficeInspectArguments(argumentList, cwd))}`;
}

export function officeInspectBudgetKey(sessionId: string, filePath: string): string {
  return `${sessionId}\0${filePath}`;
}
