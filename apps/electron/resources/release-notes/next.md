# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Edit popover stays on blur** — Clicking outside the skill / MCP / automation edit window unfocuses it instead of dismissing it. Only the title-bar close control (or leaving after a legacy send) closes the window. Fixes #384.

- **Edit popover edge resize** — The corner grip is gone. Drag the right edge, bottom edge, or bottom-right corner to resize; the top-left stays pinned and the Radix box no longer recenters on release. Fixes #385.

- **Settings header chrome** — Settings windows no longer show a leftover more (`...`) button whose only action was “Open in new window.” The unused `HeaderMenu` control is removed; Skills, Sources, and session menus keep their own open-in-new-window actions. Fixes #380.

- **Context usage ring** — Token usage now lives on a send-adjacent ring and a composition card (percent full, estimated categories Selection can measure, cache hit rate). The model picker footer, info-panel usage block, and click-to-compact percent badge are gone; manual compact is still `/compact`. Fixes #368.

- **User message copy** — Sent user bubbles keep a time and copy control under the bubble, so the icon no longer covers the text. Copy still uses the visible plain-text body (not hidden context or attachments). Fixes #372.

- **Progress evaluation chrome** — The chat transcript no longer shows the progress-evaluation status, token usage, or per-task enable checkbox. A continue link still appears if a task is actually paused.

- **Simplified automations** — Removed Agent Events and their runtime actions, tool decisions, and report-back support. Existing retired rules are ignored, imports cannot recreate them, and queued retries for inactive rules are discarded. Scheduled and app-event automations remain available. Fixes #371.

## Bug Fixes

- **User copy icon fade** — The checkmark and copy glyph on a sent user bubble now cross-fade in one 200 ms ease-in-out, instead of two clipped opacity swaps. Fixes #386.

- **Edit popover resize drift** — Dragging the skill/MCP edit window handle now grows only the right and bottom edges. The top-left stays pinned, and the handle is larger and higher-contrast. Fixes #382.

- **Context usage ring missing after a turn** — The send-adjacent ring now falls back to the last turn's occupancy when a later empty usage event zeros the live counter, so a finished session still shows context used. Fixes a regression against #368.

- **Diagram HTML delivery hang** — When a model writes an architecture HTML file and calls `submit_answer` in the same turn, the host now waits for the file write to finish and then accepts delivery instead of rejecting with “call submit_answer alone” and looping. Large HTML/SVG answers should submit a short Markdown link to the saved file. A model call that is still emitting thinking or text is no longer paused at a 10-minute wall-clock limit; only a silent idle stream still expires. Fixes #361, #363.

- **Windows caption button overlap** — Preview headers, the fused top bar, workspace-creation chrome, onboarding/reauth/workspace-picker drag regions, and the connection-setup close control now share one overlay-caption inset so in-app close and zoom controls stay clear of the native min/max/close buttons. Fixes #356, #359.

- **Broken chat images** — Markdown `![]()` images now keep local, `file:`, and `data:` sources and load them as data URLs instead of being stripped or fetched as web paths. A bare `image-preview` JSON spec without fences is promoted into the existing preview renderer so screenshots show as images instead of a code block. Missing or unreadable files show an explicit error. Fixes #358.

- **Automation creation context isolation** — Scheduled, app-event, and agent-event creation dialogs now use separate category contexts and titles. Unfinished drafts remain resumable, new automation requests no longer inherit completed creation conversations, and detail edits target the selected rule ID. Fixes #362.
