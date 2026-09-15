# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **User message copy** — Hovering a sent user bubble shows a bottom-right copy control that fades in and out. It copies the visible plain-text body (not hidden context or attachments). Fixes #372.

## Bug Fixes

- **Diagram HTML delivery hang** — When a model writes an architecture HTML file and calls `submit_answer` in the same turn, the host now waits for the file write to finish and then accepts delivery instead of rejecting with “call submit_answer alone” and looping. Large HTML/SVG answers should submit a short Markdown link to the saved file. A model call that is still emitting thinking or text is no longer paused at a 10-minute wall-clock limit; only a silent idle stream still expires. Fixes #361, #363.

- **Windows image preview caption overlap** — Fullscreen preview headers now reserve the Windows overlay caption-button strip, so zoom, copy, and close controls no longer sit under the native min/max/close buttons. Long file paths shrink instead of pushing those actions into the caption area. Fixes #356.

- **Automation creation context isolation** — Scheduled, app-event, and agent-event creation dialogs now use separate category contexts and titles. Unfinished drafts remain resumable, new automation requests no longer inherit completed creation conversations, and detail edits target the selected rule ID. Fixes #362.
