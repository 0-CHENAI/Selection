---
name: officecli
description: "Create, inspect, and edit .docx / .xlsx / .pptx with the bundled officecli CLI. Use whenever an Office file is input or output."
---

# officecli (built-in)

`officecli` is already on PATH. Do not curl-install or download it.

## Hard rule

For Word / Excel / PowerPoint, load the format skill first, then run `officecli` via Bash and follow that skill's Common Workflow and Delivery Gate.

```bash
officecli load_skill word    # or excel / pptx — do this before create
```

Or Read the matching built-in SKILL.md. Do not skip this.

| File | Skill / load_skill |
|------|---------------------|
| `.docx` / Word | `officecli-docx` / `word` |
| `.xlsx` / `.xlsm` / Excel | `officecli-xlsx` / `excel` |
| `.pptx` / PowerPoint | `officecli-pptx` / `pptx` |

`officecli create *.docx` seeds `Heading1`–`Heading3` (with `outlineLvl` 0/1/2), `Title`, and `TOCHeading`. Use those styles. Word's TOC field (`TOC \o "1-3"`) reads `outlineLvl` from `styles.xml`, not bold Normal text and not a bare `pStyle` name.

Specialized work uses `officecli-academic-paper`, `officecli-financial-model`, `officecli-data-dashboard`, `officecli-pitch-deck`, `officecli-word-form`, `morph-ppt`, or `morph-ppt-3d` — still after the matching format skill.

## Closed loop (do not skip)

1. `load_skill` / Read the format skill.
2. `create` / `open`, then `get /styles` if anything looks thin.
3. Headings first (`style=Heading1` / `Heading2` / `Heading3`), then `--type toc`.
4. If a command prints `WARNING` / `style not found` / `Error`, stop. Run `get /styles` and `officecli help docx style`. Fix styles before more content.
5. `view outline` showing Heading1 is not enough. Confirm `get /styles/Heading1`.
6. `Update field to see table of contents` is not delivery. Set `updateFields=true`. Do not claim Word page numbers are ready on Mac.
7. Run the format skill's Delivery Gate (`view issues`, `view html`, live PAGE / notes / column widths as that skill requires). Do not stop after `validate`.

## Do not

- Do not Read `~/.agents/skills/officecli` or `~/.agents/skills/docx` / `xlsx` / `pptx`. Those are not this skill.
- Do not use python-docx, openpyxl, python-pptx, or markitdown first.
- Do not ignore `style 'Heading1' not found in styles part`.
- Do not insert a TOC before heading sources exist.
