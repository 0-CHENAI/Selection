---
name: officecli
description: Create, inspect, edit, validate, and deliver Word, Excel, and PowerPoint files with Selection's bundled OfficeCLI. Use when creating or editing a .docx, .xlsx, or .pptx file, or when the user attaches one.
---

# OfficeCLI

Selection already ships the correct OfficeCLI binary and its official skills. Use the `officecli` command on PATH. Never install, download, self-update, or fall back to a user-installed OfficeCLI.

## Load only what the task needs

Before creating or editing a file, load the official instructions in this order. Load each guide at most once per task.

| Task | Commands, in order |
|---|---|
| Word | `officecli load_skill word` |
| Academic paper | `officecli load_skill word`, then `officecli load_skill academic-paper` |
| Fillable Word form | `officecli load_skill word-form` |
| Excel or XLSM | `officecli load_skill excel` |
| Financial model | `officecli load_skill excel`, then `officecli load_skill financial-model` |
| Data dashboard | `officecli load_skill excel`, then `officecli load_skill data-dashboard` |
| Financial dashboard | `officecli load_skill excel`, `officecli load_skill financial-model`, then `officecli load_skill data-dashboard` |
| PowerPoint | `officecli load_skill pptx` |
| Pitch deck | `officecli load_skill pptx`, then `officecli load_skill pitch-deck` |
| Morph deck | `officecli load_skill pptx`, then `officecli load_skill morph-ppt` |
| 3D Morph deck | `officecli load_skill pptx`, `officecli load_skill morph-ppt`, then `officecli load_skill morph-ppt-3d` |

Do not read global `~/.agents/skills/officecli`, `docx`, `xlsx`, or `pptx` instructions. The bundled `load_skill` output is the runtime source of truth. Setup sections that mention curl, PowerShell downloads, package managers, or manual installation do not apply inside Selection.

## Execution rules

- Use OfficeCLI as the only engine for `.docx`, `.docm`, `.xlsx`, `.xlsm`, and `.pptx` work. Do not switch to python-docx, openpyxl, python-pptx, or MarkItDown for a supported operation.
- Keep the resident document session open across related edits. Use `save` when an intermediate checkpoint is useful and `close` only at the final delivery gate.
- Do not impose a model-call, CLI-call, operation, QA, elapsed-time, or cost budget. Continue until the official Delivery Gate passes, the user cancels, or a genuine external blocker makes file state unverifiable.
- Treat a non-zero exit code, `WARNING`, `UNSUPPORTED`, missing output, or read-back mismatch as incomplete work. Inspect the relevant `officecli help` output, repair, and verify again.
- For OfficeCLI 1.0.144 CSV/TSV import, do not trust a successful native import alone. Use the atomic batch workflow from the Excel guide and read back representative cells before continuing.
- For `.xlsm`, preserve existing VBA parts. Verify the macro package remains present and unchanged; do not claim to create or modify VBA code.
- Legacy `.doc`, `.xls`, and `.ppt` files must be converted to OOXML before editing. Do not silently use another library.
- For Morph workflows, ignore official-guide references to `morph-helpers.py` and `morph-helpers.sh`. Selection replaces both with the cross-platform bundled command `officecli-morph-helper` (`clone`, `ghost`, `verify`, `final-check`, and `clean-accumulation`); it runs on Selection's bundled Bun runtime and requires no Python or particular user shell.

## Artifact paths

- Use the user-requested destination for the final Office file. If the user did not provide one, use the effective working directory. Set the final file variable to that absolute path.
- Put every disposable or intermediate artifact—including search results, extracted or normalized data, temporary files, Office dumps, drafts, caches, build inputs, helper scripts, and QA output—in the exact `dataFolderPath` from `<session_state>`.
- Use absolute paths for every scratch artifact. Relative scratch paths shown in an official guide, such as `blueprint.json`, `sheet.json`, `brief.md`, or temporary CSV files, are examples only and must be resolved under `dataFolderPath` inside Selection.
- Companion files required by an official guide for planning, reproducibility, or QA are still session artifacts unless the user explicitly asks to receive them. This Selection rule overrides guide delivery lists for those support files.
- If the user explicitly asks to keep a support file as a deliverable, write it to the requested location. Do not infer that every TXT or JSON file is disposable.
- Do not scan or delete pre-existing files in the working directory as cleanup. Avoid pollution by choosing the correct destination before creating an artifact.

## Delivery gate

Follow every validation and visual check required by the loaded official guide. At minimum:

1. Save the document and run the format's structural validation.
2. Read back representative content, formulas, relationships, notes, or styles.
3. Render or inspect the official preview when the guide requires visual QA.
4. Resolve every error, `WARNING`, and `UNSUPPORTED` result.
5. Close the resident document only after the final successful checks.
6. Reopen or re-read the saved artifact and confirm the delivered path exists.
7. Do not treat a chat Markdown body, `markdown-preview`, or a `call_llm` draft as the delivered file.

Selection adds one compatibility repair after Word document creation: missing Heading 1–3 `outlineLvl` values are seeded without replacing existing custom styles. If that repair reports an error, the document is not ready for delivery.
