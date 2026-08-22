# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Portable resource import and export** — Workspace settings can now export selected Skills, MCP/Sources, scheduled tasks, event triggers, and Agent events to a versioned, integrity-checked bundle, or safely preview and import one from any user-chosen file location. Dependencies are included automatically, credentials are stripped, and conflicts are resolved per resource (#55).
- **Agent automation closed loop** — Prompt actions can wait for the spawned session and write the result back (`waitForCompletion` / `reportBack`). Automations may chain up to depth 3 (per-matcher `maxDepth` 1–5) with a 10-spawns-per-minute cap per root session. `PreToolUse` can tighten an already-allowed tool with a synchronous `decision` action (`block` or `modify`). Simulate match dry-runs matcher/conditions without running actions (#66).
- **Agent Event automations now run on Pi** — matching Prompt and Webhook actions execute when a real Pi session fires events (tools, prompts, lifecycle, permissions, compaction, and `spawn_session`). New sessions are independent and non-blocking; recursion, rate limits, and oversized/secret tool data are recorded instead of dropped. `Notification` was removed because Pi has no corresponding event. Run Test still only exercises actions (#62).
- **Built-in OfficeCLI skills** — Word / Excel / PowerPoint use the official OfficeCLI skills (`officecli-docx`, `officecli-xlsx`, `officecli-pptx`, plus academic / form / financial / dashboard / pitch / Morph). The reviewed OfficeCLI binary ships in the Selection package and is already on PATH; agents call `officecli` via Bash after reading the skill. Attaching or naming a `.docx` / `.xlsx` / `.pptx` file automatically gates the matching built-in skill. These built-in skills are not listed in the Skills panel. No user install.
- **Pi-only session orchestration** — `spawn_session` can wait for a child session's conclusion or run it in the background and wake the parent when it finishes. Board tasks can be started from chat with `run_task` / `get_task_results`. Replaces the removed Claude Agent SDK Task/Workflow tools (#35).

## Improvements

- **Built-in `officecli` skill overrides `~/.agents`** — Office files (`.docx` / `.xlsx` / `.pptx`) must use the packaged `officecli` CLI. A global `officecli` or Anthropic `docx` / `xlsx` / `pptx` Read is rewritten to the built-in skill. The official format skills still supply the Delivery Gate.
- **Word `create` seeds Heading styles** — the PATH `officecli` wrapper writes Heading1–3 with `outlineLvl` (plus Title / TOCHeading) so Word can compile a TOC. Agents must `load_skill word` first and treat `style not found` as a stop, not a warning to ignore.
- **Model picker keeps every added provider selectable** — after the first message, the chat model menu still lists all configured connections and their models. Switching provider recreates the session backend on the next turn. Workspace defaults still do not silently retarget a session that already chose a connection.
- **Conservative multi-agent use** — default to doing the work in the current session; child sessions are only for explicit parallel or isolation work. Stopping a parent does not cancel children, but shows how many are still running.
- **Clearer, adaptive image resizing** — oversized Pi `read` images now retain up to a 2560px long edge, search JPEG quality 70–85 and reduce dimensions according to actual encoded size in a background Worker, preserving fine text and line detail while keeping the existing 4.5 MB guard (#42, #43).
- **Jump back to the latest message** — leaving the bottom of a long chat shows a Back to bottom control. Clicking it, scrolling back, or sending a new message hides it and restores stick-to-bottom follow for streaming output (#73).

## Bug Fixes

- **Agent Event automations no longer stall tools or spam history** — Prompt/Webhook scheduling no longer waits on session creation or HTTP; suppression is recorded only when a rule actually matched; `SubagentStop` fires when a spawned session finishes, not when background spawn returns (#62).
- **Work-chain commentary no longer flashes away** — when the model writes an explanation and then keeps calling tools, that body stays on the response card and in the step list. Tool execution is not delayed; reduced-motion users get the same stable content without the enter/exit slide (#58).
- **Windows file links open from D: and Chinese folders** — clicking an agent-generated path now treats the session working directory, project folder, and authorized Local Folders as allowed locations (not just the workspace root). Missing workspace context falls back to the window mapping, and denied paths explain how to add the folder or switch the working directory (#47).
- **Stale Task/subagent prompt guidance** — system prompt and tool docs no longer tell the model to use the removed Claude Task / Workflow tools (#35).
- **Windows image reads restored** — packaged Pi sessions now ship the Photon WASM runtime required by the built-in `read` tool; small PNG/JPEG/GIF/WebP files bypass image processing, oversized images are resized, and runtime, decoding, conversion, resize, and size-limit failures are reported separately instead of all appearing as a size error (#39).
- **Windows 10 light mode no longer grays the chrome** — Selection no longer uses Acrylic (a dark wash on Windows 10). Switching Appearance to Light updates the native window fill and stops overlaying a mismatch dim on the sidebar and title bar (#53).

## Breaking Changes

- **Native Office session tools are removed** — `office_document_inspect` / `edit` / `guide` / `preview` / `finalize` are gone. Use the built-in OfficeCLI skills and the packaged `officecli` binary via Bash. Legacy `docx-tool` / `xlsx-tool` / `pptx-tool` remain removed.
- **Anthropic official API / Claude Max OAuth / `anthropic-messages` are no longer supported** — leftover connections stay on disk but cannot send, become the default, or be selected for new sessions. Reconfigure with OpenAI Compatible or another Selection Backend provider. The Claude Agent SDK runtime and native binary are removed.
