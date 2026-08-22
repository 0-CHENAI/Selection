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
- Pass native tokens as argv and omit the leading officecli binary name. argv verbs match the official skill (create/add/set/view/get/query/validate/batch/…).
- Treat first create or office_document_guide (no topic) as load_skill: follow that official skill bootstrap, then work like the skill Common Workflow.
- Skill path: one office_document_edit batch to build → at most one outline or view issues → office_document_finalize. Do not get after every add.
- office_document_finalize is the official Delivery Gate (validate, leaks, headings, TOC/PAGE, Excel errors, plus academic / form / financial / dashboard / pitch / morph executable gates, including official WARN floors). Do not repeat those inspects unless finalize returns a blocking recovery. Multi-page Word and multi-slide PowerPoint use a contact sheet (grid auto).
- Reuse envelope.cwd and envelope.documentPath. When a property name is uncertain, call office_document_inspect argv: ['help', format, element] once. cacheHit payloads must not be retried.
- More than about 10 structural or cell edits must use batch. Existing outputs require explicit --force. Batch is atomic unless --best-effort is explicitly present.
- Never pass open, save, or close in argv. officecli load_skill maps to office_document_guide.
- Only office_document_preview.start may open or focus the Selection BrowserPane.
- deliveryReady means the official skill Delivery Gate passed for the latest revision; it is not Microsoft Office human visual approval.`;

export const OFFICE_DOCUMENT_INSPECT_DESCRIPTION = `Read Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv?: string[], recipe?, timeoutMs? }. Provide exactly one of argv or recipe. argv is the official skill command without the officecli prefix: status, help, view, get, query, validate, dump, raw, or get-marks. dump and view html write session data/office artifacts. recipe.verify / recipe.final-check are read-only Morph checks. Identical successful reads are revision-cached; identical help/status returns cacheHit; the third identical non-timeout failure is loop_prevented.`;

export const OFFICE_DOCUMENT_EDIT_DESCRIPTION = `Create or modify Office documents through Selection's reviewed OfficeCLI runtime.

Input is { argv?: string[], recipe?, batch?, timeoutMs? }. Provide exactly one of argv or recipe. argv is the official skill command without the officecli prefix: create, set, add, remove, move, swap, refresh, raw-set, add-part, batch, import, or merge. Existing create/merge outputs require --force. For batch, provide exactly one of batch.commands (max ${OFFICE_MAX_INLINE_BATCH_COMMANDS} / ${OFFICE_MAX_INLINE_BATCH_CHARS} chars) or batch.file (max ${OFFICE_MAX_BATCH_FILE_BYTES} bytes). Batch is atomic unless --best-effort. recipe.clone / recipe.ghost / recipe.clean-accumulation expand to one atomic batch. First create attaches the official skill bootstrap (load_skill).`;

export const OFFICE_DOCUMENT_GUIDE_DESCRIPTION = `Progressively load Selection's hidden, version-pinned official OfficeCLI skill guidance.

No topic is load_skill: returns the official skill bootstrap plus a heading catalog. topic returns matching sections. referencePath loads one allowlisted vendored asset. Guides never appear in Skill lists.`;

export const OFFICE_DOCUMENT_PREVIEW_DESCRIPTION = `Render or interact with an Office document preview.

render is the official skill visual audit (replaces view html / screenshot + Read). Default to one focused page; finalize uses grid auto for multi-page Word and multi-slide PowerPoint contact sheets. start is the only action allowed to open/focus Selection BrowserPane. status/stop manage the watch; goto/selection/mark/unmark/get_marks operate on it.`;

export const OFFICE_DOCUMENT_FINALIZE_DESCRIPTION = `Run revision-bound official skill Delivery Gates for a Word, Excel, or PowerPoint file.

This is the skill Delivery Gate, including specialized academic / form / financial / dashboard / pitch / morph executable checks when the document matches those skills. Selection compiles a Word TOC field only when desktop Word can paginate; otherwise probes /toc and sets updateFields=true without querying TOC styles or launching a headless-browser refresh. Multi-page/multi-slide visual evidence is one contact sheet. Screenshot failure does not block delivery. deliveryReady is true only when every blocking skill/structure check corresponds to the current artifact revision. This does not claim Microsoft Office human visual approval.`;
