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
- Before create/edit, follow the matching official skill bootstrap (auto-attached on first create, or office_document_guide with no topic). Academic papers, Word forms, pitch decks, Morph decks, financial models, and dashboards must load that specialized guide before create.
- Follow the skill Common Workflow: view outline to orient → build structure and get the new node → add content → format to spec → run view issues → office_document_finalize.
- Reuse envelope.cwd and envelope.documentPath for the rest of the session. Do not rediscover the working directory or invent a second output path.
- When a property name is uncertain, call office_document_inspect argv: ['help', format, element] once before guessing. Repeated identical help/status returns the previous payload (cacheHit) and must not be retried.
- Use office_document_inspect for view/get/query/validate/dump/raw. dump and view html write session data/office artifacts for Read. After a structural add or style change, get that path or view outline once before stacking more edits. Successful identical reads are revision-cached; change the request after an error instead of repeating it.
- Use office_document_edit for create/edit/import/merge/refresh/batch. Existing outputs require explicit --force. A turn with more than about 10 structural or cell edits must use batch (inline or batch.file), not dozens of single set calls. Batch is atomic unless --best-effort is explicitly present.
- After a non-trivial batch, run view issues. Use at most one office_document_preview.render for visual QA (default page 1, or a named page/range). grid: auto only when checking pagination or layout rhythm.
- Word: use Heading1–3 (or outlineLvl) with Heading1 ≥ 18pt, add --type toc when there are 3+ heading sources, and a PAGE footer on long or multi-page docs. Remove $var$, {var}, {{placeholders}}, lorem/ipsum, and leftover "this slide layout". Excel workbooks must not contain #REF!, #DIV/0!, #VALUE!, #NAME?, or #N/A. Rely on finalize to set updateFields=true; do not call refresh for page numbers unless desktop Word is compiling via finalize.
- Morph clone/ghost/clean-accumulation and verify/final-check go through the recipe field; do not invent shell or Python helpers.
- Resident, watch, and finalize are managed by Selection. Never pass open, save, or close in argv. officecli load_skill maps to office_document_guide.
- Only office_document_preview.start may open or focus the Selection BrowserPane.
- Finish deliverables with office_document_finalize. deliveryReady means the official skill Delivery Gate passed for the latest revision; it is not Microsoft Office human visual approval.`;

export const OFFICE_DOCUMENT_INSPECT_DESCRIPTION = `Read Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv?: string[], recipe?, timeoutMs? }. Provide exactly one of argv or recipe. argv starts with one read-only verb: status, help, view, get, query, validate, dump, raw, or get-marks. dump and view html may write artifacts under session data/office/. Do not include the officecli prefix or shell quoting. Screenshot, browser launch, management, installation, upgrade, MCP, plugin, and unknown commands are blocked. recipe.verify / recipe.final-check run read-only Morph checks. Repeated successful calls are cached by artifact revision; repeated identical help/status is reused (cacheHit) instead of re-queried; after three identical non-timeout failures Selection returns loop_prevented. After structural edits, get or view outline is expected.`;

export const OFFICE_DOCUMENT_EDIT_DESCRIPTION = `Create or modify Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv?: string[], recipe?, batch?, timeoutMs? }. Provide exactly one of argv or recipe. argv starts with create, set, add, remove, move, swap, refresh, raw-set, add-part, batch, import, or merge. Arguments are native tokens passed with spawn(binary, argv), never a shell string. Existing create/merge outputs require --force. For batch, provide exactly one of batch.commands (JSON object strings; maximum ${OFFICE_MAX_INLINE_BATCH_COMMANDS} commands / ${OFFICE_MAX_INLINE_BATCH_CHARS} serialized characters) or batch.file (JSON array; maximum ${OFFICE_MAX_BATCH_FILE_BYTES} bytes). Batch is atomic by default; --best-effort is the only partial-success mode. recipe.clone / recipe.ghost / recipe.clean-accumulation expand to one audited atomic batch. First create in a session attaches the matching official skill bootstrap.`;

export const OFFICE_DOCUMENT_GUIDE_DESCRIPTION = `Progressively load Selection's hidden, version-pinned official OfficeCLI skill guidance.

Choose one guide. With no topic/referencePath, returns the skill bootstrap (Requirements, workflow, QA / Delivery Gate, plus specialized floors such as academic Requirements, financial-model Audit & Delivery Gate, or morph-ppt-3d compatibility rules) plus a compact heading catalog. topic returns only matching sections plus compact inherited base-guide context. referencePath loads one allowlisted vendored reference asset. Internal execution rules are always prepended and cannot be overridden by user Skills. Guides never appear in Skill lists.`;

export const OFFICE_DOCUMENT_PREVIEW_DESCRIPTION = `Render or interact with an Office document preview.

render creates page/range/contact-sheet artifacts and returns a bounded inline image without opening a window. Default to one focused page. grid is only for pagination or layout-rhythm checks. start is the only action allowed to open/focus Selection BrowserPane and starts or reuses a loopback watch. status/stop manage the session reference; goto/selection/mark/unmark/get_marks operate on that watch. Preview marks are transient and never mutate the document.`;

export const OFFICE_DOCUMENT_FINALIZE_DESCRIPTION = `Run revision-bound official skill Delivery Gates for a Word, Excel, or PowerPoint file.

flushes Selection-owned runtime state, confirms the file is present and openable, compiles a Word TOC field only when desktop Word can paginate, otherwise probes /toc and sets updateFields=true without querying TOC styles or launching a headless-browser refresh, runs validate plus skill gates (placeholder leak including {var}, Heading1 ≥ 18pt, heading sources, PAGE on long or multi-page Word, TOC when 3+ heading sources, Excel error cells), then records at most one page of visual evidence. Without desktop Word, screenshots use HTML only. Files changed in this session default to strict; external read-only files default to standard. Screenshot failure does not block delivery. deliveryReady is true only when every blocking skill/structure check corresponds to the current artifact revision. This does not claim Microsoft Office human visual approval.`;
