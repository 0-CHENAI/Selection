import {
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
} from './runtime/office-coordinator.ts';

export {
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
};

export const OFFICE_WORKFLOW_PROMPT = `Office document workflow:
- OfficeCLI is the only Office execution engine. Use the five built-in Office tools; never run officecli, legacy Office CLIs, scripts, or binary file edits through Bash/Read/Write.
- Pass native tokens as argv and omit the leading officecli binary name. Tokens are sent directly to the reviewed bundled binary without a shell.
- For a complex Word, Excel, PowerPoint, form, paper, dashboard, financial-model, pitch, or Morph task, progressively load only the relevant internal guide topic with office_document_guide.
- Use office_document_inspect for status/help/view/get/query/validate/dump/raw. Successful identical reads are revision-cached; change the request after an error instead of repeating it.
- Use office_document_edit for create/edit/import/merge/refresh/batch. Existing outputs require explicit --force. Batch is atomic unless --best-effort is explicitly present.
- Use office_document_preview.render for visual evidence. Only office_document_preview.start may open or focus the Selection BrowserPane.
- Finish deliverables with office_document_finalize. deliveryReady means Selection's machine gates passed for the latest revision; it is not Microsoft Office human visual approval.`;

export const OFFICE_DOCUMENT_INSPECT_DESCRIPTION = `Read Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv: string[], timeoutMs? }. argv starts with one read-only verb: status, help, view, get, query, validate, dump, raw, or get-marks. Do not include the officecli prefix or shell quoting. Rendering output, browser launch, management, resident, installation, upgrade, MCP, plugin, and unknown commands are blocked. Repeated successful calls are cached by artifact revision; after three identical failures Selection returns loop_prevented.`;

export const OFFICE_DOCUMENT_EDIT_DESCRIPTION = `Create or modify Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv: string[], batch?, timeoutMs? }. argv starts with create, set, add, remove, move, swap, refresh, raw-set, add-part, batch, import, or merge. Arguments are native tokens passed with spawn(binary, argv), never a shell string. Existing create/merge outputs require --force. For batch, provide exactly one of batch.commands (JSON object strings; maximum ${OFFICE_MAX_INLINE_BATCH_COMMANDS} commands / ${OFFICE_MAX_INLINE_BATCH_CHARS} serialized characters) or batch.file (JSON array; maximum ${OFFICE_MAX_BATCH_FILE_BYTES} bytes). Batch is atomic by default; --best-effort is the only partial-success mode.`;

export const OFFICE_DOCUMENT_GUIDE_DESCRIPTION = `Progressively load Selection's hidden, version-pinned official OfficeCLI guidance.

Choose one guide. With no topic/referencePath, returns a compact heading catalog. topic returns only matching sections plus compact inherited base-guide context. referencePath loads one allowlisted vendored reference asset. Internal execution rules are always prepended and cannot be overridden by user Skills. Guides never appear in Skill lists.`;

export const OFFICE_DOCUMENT_PREVIEW_DESCRIPTION = `Render or interact with an Office document preview.

render creates page/range/contact-sheet artifacts and returns a bounded inline image without opening a window. start is the only action allowed to open/focus Selection BrowserPane and starts or reuses a loopback watch. status/stop manage the session reference; goto/selection/mark/unmark/get_marks operate on that watch. Preview marks are transient and never mutate the document.`;

export const OFFICE_DOCUMENT_FINALIZE_DESCRIPTION = `Run revision-bound machine delivery gates for a Word, Excel, or PowerPoint file.

flushes Selection-owned runtime state, confirms the file is present and openable, runs OfficeCLI validate and format-specific issue/content checks, then renders final visual evidence. Files changed in this session default to strict; external read-only files default to standard. deliveryReady is true only when every blocking check corresponds to the current artifact revision. This does not claim Microsoft Office human visual approval.`;
