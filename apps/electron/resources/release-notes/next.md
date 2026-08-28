# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Process notes no longer look like the final reply** — intermediate commentary stays in the work chain with the weaker step style instead of occupying the main response card. When tools start, that text remains reviewable as a step rather than a finished Copy / Markdown card. The real final reply still uses the existing response card. (#83)

- **MCP JSON and Skill file import** — Sources can import Claude Desktop / Cursor `mcpServers` JSON (including a single server or an array), and Skills can import a Zip or `SKILL.md`. Secrets are stripped, missing-auth MCP stays disabled, and Zip paths cannot escape the skills directory. (#82)


- **OpenRouter models stay current** — Settings, chat, and API setup now load the live OpenRouter catalog instead of the snapshot bundled with the app, so newly published models can be selected. Large catalogs stay collapsed to the current and configured models until you search. Retired snapshot IDs with no OpenRouter providers are hidden, and that 404 is explained as an unavailable model instead of a raw JSON dump. Choosing a live model outside the saved 3-tier list now actually sends that model instead of falling back to the stored default.

- **OfficeCLI is now one native built-in Skill** — Office attachments and explicit Word, Excel, or PowerPoint artifact requests automatically load one hidden router. It selects complete official guides on demand, uses Selection's fixed bundled runtime, keeps resident edit sessions open, and applies no Office-specific call, operation, QA, time, or cost limit.
- **Clearer task usage details** — Session Info now separates the most recent model call from the full user-task total, including model calls, input/output/cache tokens, cost, and wall-clock time while preserving legacy session statistics.

## Bug Fixes

- **Project-scoped new sessions stay in their project** — A project-filtered session list now keeps a clearly labeled “New session in {project}” action above its existing conversations. Both that action and the empty-list action inherit a single included project, so the created session appears immediately and remains correctly bound after refresh or restart. Excluded and ambiguous project filters are not inherited. (#149)

- **Codex process narration stays out of reply bodies** — Responses API text marked as internal `commentary` is held back while its phase is unknown and filtered once classified, so repeated lines such as “Let me confirm…” no longer appear alongside the final answer. (#135)

- **Work-chain titles stay concise and stable** — collapsed headers now follow semantic tool stages and explicit system status instead of copying the latest process narration. Turns that have commentary before their first tool show a neutral processing state, while later tool stages still update normally. (#141)

- **Workspace file links open reliably on Windows 10** — opening a generated Word, Excel, or other workspace file no longer times out after 30 seconds while Windows negotiates the default application. Prompt file-association errors still reach the app instead of being hidden. (#134)

- **Project navigation stays scoped to the selected project** — opening a project now selects only one of that project's conversations, or clears an unrelated global conversation when the project is empty. New Session controls preserve and verify the project binding before publishing the new conversation, so it appears in the project's list instead of only under All Sessions. (#145)

- **Windows 10 light mode no longer washes the sidebar and top bar gray** — the 50% vibrancy overlay is macOS-only. Windows paints a solid surface matching Appearance, so light mode chrome matches the settings panel instead of sitting as a dark mask over transparent regions. (#53)

- **Work-chain step counts stay on one turn** — a truncated intermediate body (often just `|`) no longer flushes the thinking chain into a finished empty card with Copy / Markdown while the session is still running. The longer streamed text is kept, pipe-only stubs are ignored instead of treated as a final reply, and later tools continue the same step count instead of restarting from 1. (#81)

- **Chinese IME first letter stays in composition** — the empty composer no longer commits the first pinyin letter as Latin text. Composition can start on the first key, and English first letters still insert after a frame if no IME session begins. (#84)

- **Chinese IME starts on the first letter** — an empty composer keeps a zero-width text node so Chromium can attach Pinyin composition, and the editor is not reclassed or rewritten on the first key. English first letters commit on keyup if IME never starts. (#107)

- **Empty composer keeps its placeholder after blur** — the contenteditable caret `<br>` and a leftover IME-pending flag are no longer treated as typed text, so the overlay returns when the box is empty and unfocused. (#108)

- **Create MCP / Skill / automation windows stay usable** — long pasted text no longer stretches the floating create window off-screen. The window is limited to the app viewport, the title bar and send controls stay reachable, the composer scrolls internally, and the window can be dragged, collapsed, or resized.

- **Long agent jobs use the normal provider lifecycle** — Live high-thinking streams are not treated as Office-specific jobs. The product's generic process safety, retry handling, and user cancellation behavior apply consistently.

- **Folder and file pickers wait while you browse** — choosing a working directory, attaching files, or confirming a native dialog no longer fails after 30 seconds.

- **Local-model turns no longer pause on a silent side request** — first-turn session titles wait until the main reply finishes, stay on the truncated placeholder if generation fails, and do not overwrite a rename or a deleted session. Utility completions stay on the selected custom-endpoint model, and the live OpenRouter catalog is only fetched when that connection is active. The local backend no longer sits idle while Selection looks stalled.

- **Reliable bundled OfficeCLI runtime** — PATH and `CRAFT_OFFICECLI` resolve Selection's trusted wrapper instead of a user-installed program; missing binaries, guide resources, Heading repair failures, warnings, and failed read-back checks cannot silently produce a completed artifact.
- **Windows packaged Pi sessions find the bundled Bun runtime** — the resolver now looks under `resources/app/vendor/bun` (the extraResources layout) instead of stopping at `resources/vendor/bun` and refusing to launch.
