# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Session list filter and grouping menu is gone** — The title-bar ListFilter control no longer offers project include/exclude or unread/project grouping. The list always groups by date. Saved exclude or multi-project filters are cleared on load so they cannot hide sessions; a single sidebar project include is kept. ([#263](https://github.com/0-CHENAI/Selection/issues/263))

## Bug Fixes

- **Child-session Error tooltips stay above the preview dialog** — Failed tool Error badges now open a bounded, scrollable tooltip. When the badge is inside a dialog (including the child-agent preview), the tooltip uses a nested layer above the dialog instead of sitting behind it. Main-session tooltips keep the default layer. ([#254](https://github.com/0-CHENAI/Selection/issues/254))

- **Top-bar back/forward follows the real in-app history again** — Returning from a session or project no longer gets immediately overwritten by auto-select or a `replaceState` sync. Button enabled state tracks the same cursor as `pushState` / `popstate`, and a new navigation after back drops the old forward branch. ([#259](https://github.com/0-CHENAI/Selection/issues/259))

- **Swarm Markdown delivery no longer dies on `_content` / fake preview tools** — Compatible endpoints that emit `write({ path, _content })` are recovered to `{ path, content }` before schema validation, without loosening extra-field rejection or bypassing PreToolUse / path permissions. The system prompt now states that `markdown-preview` is fenced reply syntax, not a tool, and those pseudo-tool calls are counted by provider/model instead of being rewritten into text. ([#255](https://github.com/0-CHENAI/Selection/issues/255))
