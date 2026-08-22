---
name: officecli
description: "Create, inspect, and edit .docx / .xlsx / .pptx with the bundled officecli CLI. Use whenever an Office file is input or output."
---

# officecli (built-in)

`officecli` is already on PATH. Do not curl-install or download it.

## Hard rule

For Word / Excel / PowerPoint, Read the matching built-in format skill, then run `officecli` via Bash and follow that skill's Common Workflow and Delivery Gate.

| File | Skill |
|------|--------|
| `.docx` / Word | `officecli-docx` |
| `.xlsx` / `.xlsm` / Excel | `officecli-xlsx` |
| `.pptx` / PowerPoint | `officecli-pptx` |

Specialized work uses `officecli-academic-paper`, `officecli-financial-model`, `officecli-data-dashboard`, `officecli-pitch-deck`, `officecli-word-form`, `morph-ppt`, or `morph-ppt-3d` — still after the matching format skill.

## Do not

- Do not Read `~/.agents/skills/officecli` or `~/.agents/skills/docx` / `xlsx` / `pptx`. Those are not this skill.
- Do not use python-docx, openpyxl, python-pptx, or markitdown first.
- Do not stop after `validate`. Run the format skill's Delivery Gate (`view issues`, `view html`, live PAGE / notes / column widths as that skill requires).
