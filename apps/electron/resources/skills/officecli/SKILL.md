---
name: officecli
description: "Advanced OfficeCLI guidance for complex Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) workflows, including formatting, charts, and raw OpenXML. Ordinary operations use Selection's native Office document tools without loading this skill."
icon: "📄"
globs:
  - "*.docx"
  - "*.xlsx"
  - "*.pptx"
---

# officecli

Advanced guidance for Selection's bundled OfficeCLI support for `.docx`, `.xlsx`, and `.pptx`. Ordinary document work should use the always-available `office_document_inspect` and `office_document_edit` tools directly; loading this skill is optional. The compatibility `officecli` binary is already on PATH — **do not curl-install or download it**.

Prefer this over `docx-tool` / `xlsx-tool` / `pptx-tool` for create/edit/inspect. Use `markitdown` only when you need readable text, not a real Office file.

## Strategy

**L1 (read) → L2 (DOM edit) → L3 (raw XML)**. Prefer higher layers. Add `--json` for structured output.

**Before document work, load one specialized skill** (see bottom). Run `officecli load_skill <name>` once, then follow that printed SKILL.md. Do not stack two scene skills on the same file.

## Help first

When unsure about property names, value formats, or syntax, run help instead of guessing.

```bash
officecli help                     # commands + global options
officecli help docx                # docx elements
officecli help docx paragraph      # full schema
officecli help docx set paragraph  # props valid with `set`
officecli help docx paragraph --json
```

Aliases: `word`→`docx`, `excel`→`xlsx`, `ppt`/`powerpoint`→`pptx`.

## Resident mode

The first command auto-starts a resident (60s idle). For multi-step edits, open explicitly and close when another program must read the file:

```bash
officecli open report.docx
officecli set report.docx ...
officecli close report.docx    # flush + release
```

Do not leave files locked. After the last mutation in a turn, `close` (or `save` if you will keep editing). Paths with Chinese or spaces work — always quote them.

## L1: Create, read, inspect

```bash
officecli create <file>                 # type from extension
officecli view <file> <mode>            # outline | stats | issues | text | annotated | html
officecli get <file> <path> --depth N   # node + children [--json]
officecli query <file> <selector>       # CSS-like
officecli validate <file>
```

`view text` is the fastest way to read content. `view issues` after edits.

Prefer stable IDs from `get` (`@id=`, `@paraId=`, `@name=`) over positional indexes that shift on insert/delete.

## L2: DOM

```bash
officecli set <file> <path> --prop key=value
officecli add <file> <parent> --type <type> [--prop ...]
officecli add <file> <parent> --type <type> --after <path>
officecli remove <file> <path>
officecli move <file> <path> [--to <parent>] [--after <path>]
```

Quote paths so the shell does not glob brackets: `'/slide[1]'`, `'/body/p[1]'`.

Colors: `FF0000`, `#FF0000`, `red`. Spacing: `12pt`, `0.5cm`. Use `--prop`, never `--name`. Quote non-ASCII and `$` values: `--prop text='巡察工作摘要'`.

```bash
# Word — quote Chinese text; Heading1 may be absent on a blank create
officecli add report.docx /body --type paragraph --prop text='巡察工作摘要' --prop bold=true --prop size=16pt

# Excel
officecli set data.xlsx /Sheet1/A1 --prop value="Name" --prop bold=true

# PowerPoint
officecli add slides.pptx / --type slide --prop title="Q4 Report"
```

Find/replace:

```bash
officecli set doc.docx / --find draft --replace final
```

Batch (atomic by default — any failure rolls the file back):

```bash
officecli batch data.xlsx --commands '[{"command":"set","path":"/Sheet1/A1","props":{"value":"Done"}}]' --json
```

## L3: Raw XML

Only when L2 cannot express the change.

```bash
officecli raw <file> <part>
officecli raw-set <file> <part> --xpath "..." --action replace --xml '<w:p>...</w:p>'
```

## Pitfalls

| Wrong | Right |
|-------|--------|
| `--name "foo"` | `--prop name="foo"` |
| Unquoted `/slide[1]` | `'/slide[1]'` |
| Guessing property names | `officecli help <format> <element>` |
| Editing a file still open in WPS/Word | Close it first |
| `$` in `--prop text="$15M"` | Single quotes: `--prop text='$15M'` |
| Leaving resident open | `officecli close <file>` |
| Promising PDF export | Not in this binary (plugin, not bundled) |

## Specialized skills

`officecli load_skill` lists them. Load **one** per artifact:

| Name | When |
|------|------|
| `word` | Reports, letters, memos, generic .docx |
| `academic-paper` | Thesis / journal only |
| `pptx` | Generic decks |
| `pitch-deck` | Fundraising only |
| `morph-ppt` / `morph-ppt-3d` | Morph animation decks |
| `excel` | Generic workbooks |
| `financial-model` | Models / projections |
| `data-dashboard` | KPI dashboards |

Example: `officecli load_skill word` then follow the printed rules.

## Notes

- Paths are 1-based (`'/body/p[3]'` is the third paragraph). `--index` is 0-based except Excel row/col add (1-based).
- After edits: `validate` and/or `view issues`.
- Workspace paths may contain Chinese. Quote every file path.
