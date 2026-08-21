# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Agent Event automations now run on Pi** — matching Prompt and Webhook actions execute when a real Pi session fires events (tools, prompts, lifecycle, permissions, compaction, and `spawn_session`). New sessions are independent and non-blocking; recursion, rate limits, and oversized/secret tool data are recorded instead of dropped. `Notification` was removed because Pi has no corresponding event. Run Test still only exercises actions (#62).
- **Native Office document tools** — Word / Excel / PowerPoint now expose the reviewed OfficeCLI document surface through five structured tools: inspect, edit/batch, hidden official guides, inline or live preview, and revision-bound finalization. OfficeCLI remains app-managed rather than appearing as an installable skill.
- **Pi-only session orchestration** — `spawn_session` can wait for a child session's conclusion or run it in the background and wake the parent when it finishes. Board tasks can be started from chat with `run_task` / `get_task_results`. Replaces the removed Claude Agent SDK Task/Workflow tools (#35).

## Improvements

- **Conservative multi-agent use** — default to doing the work in the current session; child sessions are only for explicit parallel or isolation work. Stopping a parent does not cancel children, but shows how many are still running.
- **Clearer, adaptive image resizing** — oversized Pi `read` images now retain up to a 2560px long edge, search JPEG quality 70–85 and reduce dimensions according to actual encoded size in a background Worker, preserving fine text and line detail while keeping the existing 4.5 MB guard (#42, #43).

## Bug Fixes

- **Agent Event automations no longer stall tools or spam history** — Prompt/Webhook scheduling no longer waits on session creation or HTTP; suppression is recorded only when a rule actually matched; `SubagentStop` fires when a spawned session finishes, not when background spawn returns (#62).
- **Work-chain commentary no longer flashes away** — when the model writes an explanation and then keeps calling tools, that body stays on the response card and in the step list. Tool execution is not delayed; reduced-motion users get the same stable content without the enter/exit slide (#58).
- **Windows file links open from D: and Chinese folders** — clicking an agent-generated path now treats the session working directory, project folder, and authorized Local Folders as allowed locations (not just the workspace root). Missing workspace context falls back to the window mapping, and denied paths explain how to add the folder or switch the working directory (#47).
- **Office paths and previews are deterministic** — OfficeCLI receives native argument tokens, so new folders and paths containing spaces, Chinese text, or shell metacharacters work without quoting failures. Rendered previews stay inline unless live preview is explicitly started; runtime binaries and vendored guides are checked against the reviewed release manifest before use (#60).
- **Excel import no longer reports success without data** — the pinned OfficeCLI 1.0.144 binary can acknowledge CSV/TSV import without persisting any cells. Selection now tries native import first, asserts a real cell value, and only then falls back to one atomic OfficeCLI batch; JSON sources are supported, and `--stdin` still requires an authorized file first.
- **Office documents stay hot and inspectable** — a session-owned resident lease keeps successive edits off full-file reloads, then flushes before preview, dump/HTML artifacts, and finalize. `dump` and `view html` write under session `data/office/` for Read; Morph clone/ghost/verify run as structured recipes instead of shell or Python helpers. `open` / `save` / `close` remain app-managed.
- **Office edits stay within the model output budget** — large Word / Excel / PowerPoint writes go through a JSON `batchCommandsFile` instead of a single huge tool-call payload. Inline `batchCommands` and long `--prop` arguments are capped; oversized calls are rejected with a “do not retry the same payload” hint so the model splits the work or writes a file first (#48).
- **Office generation no longer loops on inspect** — creating or editing Word / Excel / PowerPoint files now follows a bounded native OfficeCLI workflow (create + batch, one focused read, optional schema validate). Dump/raw are not default readers, truncated inspects return a short next-step envelope, successful same-revision reads are cached, and only the third identical failure is stopped as `loop_prevented` instead of imposing a global inspect budget (#49).
- **Stale Task/subagent prompt guidance** — system prompt and tool docs no longer tell the model to use the removed Claude Task / Workflow tools (#35).
- **Windows image reads restored** — packaged Pi sessions now ship the Photon WASM runtime required by the built-in `read` tool; small PNG/JPEG/GIF/WebP files bypass image processing, oversized images are resized, and runtime, decoding, conversion, resize, and size-limit failures are reported separately instead of all appearing as a size error (#39).

## Breaking Changes

- **Legacy Word / Excel / PowerPoint Python wrappers are removed** — packaged `docx-tool`, `xlsx-tool`, and `pptx-tool` commands and their default permissions are gone. Agents must use the five native Office document tools backed by the reviewed OfficeCLI runtime.
- **Anthropic official API / Claude Max OAuth / `anthropic-messages` are no longer supported** — leftover connections stay on disk but cannot send, become the default, or be selected for new sessions. Reconfigure with OpenAI Compatible or another Selection Backend provider. The Claude Agent SDK runtime and native binary are removed.
