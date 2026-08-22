---
name: officecli-execution
description: Selection's batching and QA policy for efficient OfficeCLI document creation and editing. Read after the matching official OfficeCLI format skill for Office-file work.
---

# OfficeCLI execution policy

The official format skill remains authoritative for document structure, styling, and format-specific validation. This policy controls execution granularity and takes precedence when workflow wording overlaps.

## Batch independent content

- Plan the document operations before mutating the file.
- Before the first `officecli_batch`, create the target exactly once with the app-managed `officecli create "$FILE"` Bash command. The typed batch tool edits an existing document; it does not create one. Treat a successful `create` as sufficient startup and do not follow it with `open`.
- For routine document generation, do not run environment-discovery or capability-probing commands such as `which officecli`, `officecli --version`, `status`, `help`, or `load_skill`. Selection has already selected the reviewed runtime and loaded the format skill. Use one focused help lookup only when a property or advanced command is genuinely absent from the loaded format skill.
- Partition an ordinary document build into 2–6 total `officecli_batch` calls. Keep compatible cover, body, table, footer, field, and style work together instead of turning each structure operation into a singleton call.
- Execute genuinely dependent structural operations—such as defining styles, creating a table before filling it, inserting a TOC after headings, or creating sections before their content—at explicit checkpoints, but coalesce all operations that are compatible at each checkpoint.
- When five or more independent `add` or `set` operations are ready, use `officecli_batch`; do not issue one Bash call per paragraph, cell, or slide element.
- Prefer 20–50 operations per batch when enough work remains. A final batch may contain fewer than 20 operations. Do not validate between ordinary mutation batches; run the single final QA after all content and structure are assembled.
- A successful structured batch result is authoritative for that checkpoint. Do not run `view`, `get`, `query`, or `open` merely to confirm every successful batch.
- Use at most one dependency checkpoint with `get` or `query` during an ordinary build. Put independent reads in the same batch when possible.

If `officecli_batch` is unavailable, send the same operations in one Bash invocation using this quoted-heredoc shape (replace the JSON array, not the command structure):

```bash
officecli batch "$FILE" --stop-on-error --json <<'OFFICECLI_BATCH_JSON'
[{"command":"add","parent":"/body","type":"paragraph","props":{"text":"..."}}]
OFFICECLI_BATCH_JSON
```

On Windows PowerShell, use one literal here-string piped to the same command instead of issuing per-operation commands:

```powershell
@'
[{"command":"add","parent":"/body","type":"paragraph","props":{"text":"..."}}]
'@ | officecli batch "$env:FILE" --stop-on-error --json
```

The default atomic mode must remain enabled. Preserve operation order and stop on the first error. Do not fall back to one shell call per operation.

The Shell fallback deliberately removes generator attribution and cannot preserve an explicitly requested OfficeCLI credit. If attribution is required but typed tools are unavailable, disclose that limitation to the user instead of weakening the filter. Normal OfficeCLI research, commands, version details, and performance analysis remain valid document content and are not generator attribution.

## Verify once, repair once

- For an ordinary task, run `officecli_qa` once in `balanced` mode after content is assembled.
- If QA reports a failure, make one focused repair batch and run QA once more. Do not start an open-ended visual-polish loop unless the user explicitly requested print-grade or page-by-page review.
- If `officecli_qa` is unavailable, combine the official format skill's structural checks into the fewest practical read-only calls.
- When QA reports `visualStatus=skipped_no_vision`, the final reply must explicitly say: “结构验证通过，未做像素级视觉确认” (or the same statement in the user's language). When rendering fails, explicitly say that pixel-level visual confirmation could not be completed. Never imply pixel-level verification in either case.
- After the final QA (or its single repair-and-QA retry), run only the required `save`/`close` finalization and deliver the file. Do not reopen it or start another polish loop.

## Keep implementation details out of the artifact

Do not add OfficeCLI, Selection, model, generator, or internal workflow attribution to document content, headers, footers, comments, custom properties, or metadata unless the user explicitly requested that attribution.
