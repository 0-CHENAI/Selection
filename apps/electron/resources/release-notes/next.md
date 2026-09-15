# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **User message copy** — Sent user bubbles keep a time and copy control under the bubble, so the icon no longer covers the text. Copy still uses the visible plain-text body (not hidden context or attachments). Fixes #372.

- **Progress evaluation chrome** — The chat transcript no longer shows the progress-evaluation status, token usage, or per-task enable checkbox. A continue link still appears if a task is actually paused.

- **Simplified automations** — Removed Agent Events and their runtime actions, tool decisions, and report-back support. Existing retired rules are ignored, imports cannot recreate them, and queued retries for inactive rules are discarded. Scheduled and app-event automations remain available. Fixes #371.

## Bug Fixes

- **Diagram HTML delivery hang** — When a model writes an architecture HTML file and calls `submit_answer` in the same turn, the host now waits for the file write to finish and then accepts delivery instead of rejecting with “call submit_answer alone” and looping. Large HTML/SVG answers should submit a short Markdown link to the saved file. A model call that is still emitting thinking or text is no longer paused at a 10-minute wall-clock limit; only a silent idle stream still expires. Fixes #361, #363.

- **Windows image preview caption overlap** — Fullscreen preview headers now reserve the Windows overlay caption-button strip, so zoom, copy, and close controls no longer sit under the native min/max/close buttons. Long file paths shrink instead of pushing those actions into the caption area. Fixes #356.

- **Automation creation context isolation** — Scheduled, app-event, and agent-event creation dialogs now use separate category contexts and titles. Unfinished drafts remain resumable, new automation requests no longer inherit completed creation conversations, and detail edits target the selected rule ID. Fixes #362.
