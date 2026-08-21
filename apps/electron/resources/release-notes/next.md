# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Agent Event automations now run on Pi** — matching Prompt and Webhook actions execute when a real Pi session fires events (tools, prompts, lifecycle, permissions, compaction, and `spawn_session`). New sessions are independent and non-blocking; recursion, rate limits, and oversized/secret tool data are recorded instead of dropped. `Notification` was removed because Pi has no corresponding event. Run Test still only exercises actions (#62).
- **Native Office document tools** — Word / Excel / PowerPoint inspection and editing now use an always-available, structured runtime backed by the bundled `officecli` binary, without exposing OfficeCLI as a skill.
- **Pi-only session orchestration** — `spawn_session` can wait for a child session's conclusion or run it in the background and wake the parent when it finishes. Board tasks can be started from chat with `run_task` / `get_task_results`. Replaces the removed Claude Agent SDK Task/Workflow tools (#35).

## Improvements

- **Conservative multi-agent use** — default to doing the work in the current session; child sessions are only for explicit parallel or isolation work. Stopping a parent does not cancel children, but shows how many are still running.
- **Clearer, adaptive image resizing** — oversized Pi `read` images now retain up to a 2560px long edge, search JPEG quality 70–85 and reduce dimensions according to actual encoded size in a background Worker, preserving fine text and line detail while keeping the existing 4.5 MB guard (#42, #43).

## Bug Fixes

- **Work-chain commentary no longer flashes away** — when the model writes an explanation and then keeps calling tools, that body stays on the response card and in the step list. Tool execution is not delayed; reduced-motion users get the same stable content without the enter/exit slide (#58).
- **Windows file links open from D: and Chinese folders** — clicking an agent-generated path now treats the session working directory, project folder, and authorized Local Folders as allowed locations (not just the workspace root). Missing workspace context falls back to the window mapping, and denied paths explain how to add the folder or switch the working directory (#47).
- **Office edits stay within the model output budget** — large Word / Excel / PowerPoint writes go through a JSON `batchCommandsFile` instead of a single huge tool-call payload. Inline `batchCommands` and long `--prop` arguments are capped; oversized calls are rejected with a “do not retry the same payload” hint so the model splits the work or writes a file first (#48).
- **Office generation no longer loops on inspect** — creating or editing Word / Excel / PowerPoint files now follows a bounded native OfficeCLI workflow (create + batch, one focused read, optional schema validate). Dump/raw are not default readers, truncated inspects return a short next-step envelope, DOCX refresh states the Word + Windows limit, and repeated inspects on the same file stop after a session budget instead of staying on Thinking… (#49).
- **Stale Task/subagent prompt guidance** — system prompt and tool docs no longer tell the model to use the removed Claude Task / Workflow tools (#35).
- **Windows image reads restored** — packaged Pi sessions now ship the Photon WASM runtime required by the built-in `read` tool; small PNG/JPEG/GIF/WebP files bypass image processing, oversized images are resized, and runtime, decoding, conversion, resize, and size-limit failures are reported separately instead of all appearing as a size error (#39).

## Breaking Changes

- **Anthropic official API / Claude Max OAuth / `anthropic-messages` are no longer supported** — leftover connections stay on disk but cannot send, become the default, or be selected for new sessions. Reconfigure with OpenAI Compatible or another Selection Backend provider. The Claude Agent SDK runtime and native binary are removed.
