# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **New orchestrations use V3 YAML import** — Import a YAML file or paste a definition with explicit `schema_version: 3`. Invalid definitions, older versions and duplicate task IDs are rejected before saving. Form creation, natural-language generation and Agent task-creation tools are unavailable. Existing tasks retain their versioned editing flow. Imports do not start runs; the default runner remains `conduct`, and `orchestrate` retains its preview/opt-in gate.

## Improvements

- **List / import-orchestration controls no longer jump between views** — Desktop keeps search and the switcher together in one top-bar slot immediately after the workspace selector. Opening or leaving the YAML import editor now changes only the selected switcher item and main content, while project context and return navigation stay intact; unsaved YAML or existing-task edits are confirmed before either control leaves the editor. ([#283](https://github.com/0-CHENAI/Selection/issues/283))

- **Windows title bar now shares a row with the Selection top bar** — The extra native title-bar strip is gone. Minimize, maximize, and close stay on the right via the Windows overlay; the rest of the bar stays draggable and keeps sidebar, back/forward, and workspace controls. ([#260](https://github.com/0-CHENAI/Selection/issues/260))

- **Desktop top bar drops the brand menu, creation-jobs icon, and add-panel plus** — Sidebar, back/forward, workspace, and browser badges stay. Creation jobs still validate and notify in the background; reopen/stop lives on the Sources, Skills, and Automations headers. New chat in a panel still uses its shortcut. Compact keeps the mobile app menu. ([#262](https://github.com/0-CHENAI/Selection/issues/262))

- **Session controls are now search, then list / new orchestration** — The magnifier stays immediately left of the switcher and still opens the existing session search field. Compact widths keep search in the list header and hide the switcher. ([#264](https://github.com/0-CHENAI/Selection/issues/264))

- **Task board is now a new-orchestration editor** — The list/orchestration switcher stays. Its second view opens the existing create/edit orchestration editor instead of columns, cards, drag-and-drop, or board filters. A project-scoped list binds the new orchestration to that project. ([#261](https://github.com/0-CHENAI/Selection/issues/261))

- **Session list filter and grouping menu is gone** — The title-bar ListFilter control no longer offers project include/exclude or unread/project grouping. The list always groups by date. Saved exclude or multi-project filters are cleared on load so they cannot hide sessions; a single sidebar project include is kept. ([#263](https://github.com/0-CHENAI/Selection/issues/263))

## Bug Fixes

- **升级内置 OfficeCLI 至 v1.0.147**：桌面运行时、官方 Schema/Guides/Skills 和六个平台资产已同步到上游稳定版；`import` 新增的 `--delimiter` 与 `--decimal` 参数已纳入命令分类审查，运行时自更新仍保持禁用（#276）。

- **Orchestration chat shows live node progress while a run is active** — Create-and-run still opens the orchestrator session. That session now lists each node’s live state in the main pane, instead of leaving only the composer Swarm pill while the transcript stays on the definition confirmation.

- **Running orchestrations no longer look finished in the last reply** — While child nodes are still running, the definition confirmation hides regenerate / copy / markdown, and the composer shows Stop instead of Send.

- **Child-session Error tooltips stay above the preview dialog** — Failed tool Error badges now open a bounded, scrollable tooltip. When the badge is inside a dialog (including the child-agent preview), the tooltip uses a nested layer above the dialog instead of sitting behind it. Main-session tooltips keep the default layer. ([#254](https://github.com/0-CHENAI/Selection/issues/254))

- **Top-bar back/forward follows the real in-app history again** — Returning from a session or project no longer gets immediately overwritten by auto-select or a `replaceState` sync. Button enabled state tracks the same cursor as `pushState` / `popstate`, and a new navigation after back drops the old forward branch. ([#259](https://github.com/0-CHENAI/Selection/issues/259))

- **Swarm Markdown delivery no longer dies on `_content` / fake preview tools** — Compatible endpoints that emit `write({ path, _content })` are recovered to `{ path, content }` before schema validation, without loosening extra-field rejection or bypassing PreToolUse / path permissions. The system prompt now states that `markdown-preview` is fenced reply syntax, not a tool, and those pseudo-tool calls are counted by provider/model instead of being rewritten into text. ([#255](https://github.com/0-CHENAI/Selection/issues/255))
