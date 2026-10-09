# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Consistent session modes** — Conversations created by external clients now publish their actual mode to every window, avoiding a PRO task appearing under a NORM header. Genuine NORM sessions continue to reject delegation. Issue #466.

- **Original-source navigation** — PRO research can freeze successfully fetched web originals and locate native PDF pages, Word paragraphs, Excel cells and PowerPoint slides by content version. Directory indexes remain navigation; only successfully returned original ranges count as read receipts. Existing Office/PDF Skills retain their full workflow. Issues #460 and #464.

- **Authorized project history** — Projects can explicitly enable PRO history search with exact message/version expansion and native compaction lineage. Changed or deleted history is invalidated; fresh conversations do not automatically inherit other chats, and sibling execution contexts remain isolated. Issue #471.

- **Plan explanation and history replay** — The existing workbench adds task, data, control, actor and research views, static preflight, revision impact and read-only event history. Replay uses frozen revisions without dispatching models or applying changes. Issue #465.

- **Coordinator-first task help** — A blocked worker records its problem, attempted steps and needed decision, yields only its task slot, then continues the same execution after the root replies. Replies retain the current authority; Stop and restart retire lost waiting instances while preserving history. Issue #449.

- **Research corrections** — Append-only errata invalidate exact claim/source versions, dependent reasoning and historical reports until independently reviewed corrections are available. Frozen handovers disclose later associated corrections without rewriting their snapshots. Part of #449.

- **Research source bundles** — Deep Research records successful original Read ranges with exact source and execution versions, and separates cited, uncited, unresolved and unrecorded material. New research plans require the author and independent reviewer to read the cited ranges themselves; compatible successors preserve verified history. Part of #449.

- **PRO chat planning** — Complex goals can create one canonical plan on the current PRO conversation and start asynchronously within its existing authorization. Stable creation and start requests prevent duplicate plans and runs; saving in the editor remains separate from execution.

- **Reliable task recovery** — Context admission checks cover subsequent tool-loop requests, and execution checkpoints retain confirmed progress. Restart recovery verifies execution ownership, permissions and tool receipts before continuing; uncertain writes pause with details in the existing error panel.

- **Traceable revisions and collaboration** — Body feedback keeps its source, result and history. New writing tasks use isolated candidates, validation and runtime integration, preserving project edits and surfacing conflicts in the existing collaboration details.

## Improvements

- **Independent premise review and research stages** — New research plans record conditions that could overturn important conclusions, independent premise critiques and explicit decisions for alternative-premise candidates. Fact repairs remain on their original line; local reports can complete while unrelated lines continue. Stage readiness follows current evidence, review and issue disposition, independently of worker completion. Older records explicitly show missing judgment history. Issue #449.

- **Fair model request concurrency** — Conversations, coordinators, workers and utility calls now share host-owned request slots by provider account and endpoint. Queues rotate between runs, release slots during rate-limit backoff, honor Retry-After, and adapt concurrency after throttling. Waiting time is excluded from the active request timeout; cancellation returns queued and active slots. Codex uses its supported SSE transport so requests participate in the same accounting.

- **Compact artifact history** — File changes requested in chat are recorded automatically. Version history shows version numbers, short identifiers, summaries and previews, without a separate edit form or explanatory paragraphs. Existing primary files retain their own history when alternative recovery paths refer to another file.

- **Interactive HTML artifacts** — HTML files and `html-preview` entries now open in the built-in browser with working scripts, animation and relative assets. Generated pages use temporary isolated browser sessions. The previous HTML iframe preview and its custom zoom controls are removed. Version previews open the selected document snapshot; separate resource files are not archived.

- **Safer Office document edits** — Bundled OfficeCLI is updated to v1.0.152. After a warned or failed write, the agent checks for partial changes before retrying so it does not duplicate document content. PR #417.

- **Simpler settings** — The Input page, spell check, send-key choice, and project color highlight are removed. Connection icons are now labeled provider icons, and an empty default-sources section uses the same settings card as the other rows. Advanced settings store an optional AnySearch API key locally without showing the saved value. PRO now provides orchestration in standard builds, with an explicit build override for disabling it. Fixes #413.

- **Document previews** — HTML and Markdown inline cards show file identity and clear boundaries; full content opens in a scrollable preview dialog without expanding the conversation. Keyboard focus returns to the opener after closing. Fixes #409.

- **Interactive tables by default** — Tabular answers and comparisons prefer the built-in datatable renderer, including small datasets. Spreadsheet export and explicitly requested Markdown output remain available.

- **Stable reference sources** — Numbered, emphasized, bare-URL and reference-style citations no longer flash in streaming replies. Known sources reserve their footer space so completion does not resize the answer card.

- **Leaner agent context** — Rendering guides load on demand, duplicate Pi tool aliases are omitted from model requests while remaining executable, and context usage distinguishes estimated skill catalogs from loaded content. Swarm delegation follows one session policy.

- **Natural document writing** — Prose drafting and revision can load a compact built-in writing skill to reduce formulaic language while preserving facts, citations, and the requested voice. Explicitly selecting the bundled `natural-writing` now supplies its instructions for the whole turn, including context compaction; the skill catalog also recognizes requests to remove an “AI” tone. Ordinary chat, code, and formatting-only tasks do not automatically load its body.

- **App icon** — Windows and macOS now use the macOS 27 Liquid Glass conversion of the Selection swan (live `.icon` on recent macOS, flattened PNG/ICO/ICNS elsewhere).

- **Edit popover stays on blur** — Clicking outside the skill / MCP / automation edit window unfocuses it instead of dismissing it. Only the title-bar close control (or leaving after a legacy send) closes the window. Fixes #384.

- **Edit popover edge resize** — The corner grip is gone. Drag the right edge, bottom edge, or bottom-right corner to resize; the top-left stays pinned and the Radix box no longer recenters on release. Fixes #385.

- **Settings header chrome** — Settings windows no longer show a leftover more (`...`) button whose only action was “Open in new window.” The unused `HeaderMenu` control is removed; Skills, Sources, and session menus keep their own open-in-new-window actions. Fixes #380.

- **Context usage ring** — Token usage now lives on a send-adjacent ring and a composition card (percent full, estimated categories Selection can measure, cache hit rate). The model picker footer, info-panel usage block, and click-to-compact percent badge are gone; manual compact is still `/compact`. Fixes #368.

- **User message copy** — Sent user bubbles keep a time and copy control under the bubble, so the icon no longer covers the text. Copy still uses the visible plain-text body (not hidden context or attachments). Fixes #372.

- **Progress evaluation chrome** — The chat transcript no longer shows the progress-evaluation status, token usage, or per-task enable checkbox. A continue link still appears if a task is actually paused.

- **Simplified automations** — Removed Agent Events and their runtime actions, tool decisions, and report-back support. Existing retired rules are ignored, imports cannot recreate them, and queued retries for inactive rules are discarded. Scheduled and app-event automations remain available. Fixes #371.

- **Unified work-chain header** — Thinking and numbered steps share one title row and enter or leave on the same height curve as the processing indicator. The collapsed title no longer appends an error count, and the chevron stays in document flow so the rounded chrome does not clip it. Fixes #405.

## Bug Fixes

- **Live work previews** — Collapsed work headers follow the latest actual activity instead of a pending downstream task whose status arrived later.

- **Async research progress** — Start acknowledgments keep their lightweight transcript style while waiting for the coordinator, verifying or repairing. They no longer show final-answer actions or a dashed bubble; completed answers retain their normal cards and controls.

- **Internal tool snapshots** — Long tool-response snapshots stay in session scratch storage and no longer appear as delivered TXT files in the conversation.

- **Coordinator checkpoint progress** — Actual model output and tool progress renew the coordinator inactivity lease. Accepted decisions yield to the next host checkpoint, and fresh PRO roots can answer worker help requests without restarting the conversation. Issue #466.

- **Original failed-node recovery** — Coordinators can explicitly retry the original failed nodes after workers settle, then correct their pending definitions at the next checkpoint. Unrelated successes and failure history are preserved; replacement work cannot silently erase an original failure. Issue #466.

- **Coordinator help replies** — PRO workflow roots retain the structured help tool when a worker yields for guidance, and interrupted host-owned help waits can recover safely. Exact-premise rejections identify the differing entry so a worker can correct its submission without changing frozen research criteria.

- **Help restart recovery** — Lost worker help waits now use normal retry safety checks and a fresh execution attempt, preserving completed sibling results and retiring late replies. They no longer try to resume a progress checkpoint that was never created.

- **Stable project history versions** — Re-saving an unchanged message with a different JSON field order no longer invalidates its history reference. Content, role and original identity changes still require a new search.

- **Compact coordinator checkpoints** — Research checkpoints and final verification carry current claim versions, review status and unresolved limits while referring to canonical receipts on demand. Repeated read histories no longer overwhelm the parent context; complete receipts remain available for independent verification.

- **Cancelled plan nodes** — Coordinator removal of pending work now retires its execution state along with the canonical node, so an obsolete node cannot block final verification. Unresolved live failures remain blocking.

- **Indexed research snapshots** — Research plans can use the text snapshot returned by document navigation directly while retaining original-file versions and native page/cell locations. Changed originals and corrupt snapshots remain unavailable. Issues #460 and #464.

- **Chat composer with run history** — Long reports and task progress no longer push the composer below the window; its model and send controls remain visible.

- **Independent review and verified context** — Verify and judge nodes always start a fresh context. Actor reuse requires a completed execution, known outcomes, matching model and authorization, and unchanged inputs. A confirmed native write cannot conceal an intervening external file change.

- **Upstream service failures** — Proxy 500/502/503/504 responses mentioning authentication are classified as service errors, avoiding a misleading API-key refresh and preserving the recorded task state.

- **Conversation navigation previews** — Hover previews on the left conversation rail now keep only one visual line of the user message, add an ellipsis when it overflows, and preserve the gray response summary. Fixes #397.

- **User copy icon fade** — The checkmark and copy glyph on a sent user bubble now cross-fade in one 200 ms ease-in-out, instead of two clipped opacity swaps. Fixes #386.

- **Edit popover resize drift** — Dragging the skill/MCP edit window handle now grows only the right and bottom edges. The top-left stays pinned, and the handle is larger and higher-contrast. Fixes #382.

- **Context usage ring missing after a turn** — The send-adjacent ring now falls back to the last turn's occupancy when a later empty usage event zeros the live counter, so a finished session still shows context used. Fixes a regression against #368.

- **Diagram HTML delivery hang** — When a model writes an architecture HTML file and calls `submit_answer` in the same turn, the host now waits for the file write to finish and then accepts delivery instead of rejecting with “call submit_answer alone” and looping. Large HTML/SVG answers should submit a short Markdown link to the saved file. A model call that is still emitting thinking or text is no longer paused at a 10-minute wall-clock limit; only a silent idle stream still expires. Fixes #361, #363.

- **Windows caption button overlap** — Preview headers, the fused top bar, workspace-creation chrome, onboarding/reauth/workspace-picker drag regions, and the connection-setup close control now share one overlay-caption inset so in-app close and zoom controls stay clear of the native min/max/close buttons. Fixes #356, #359.

- **Broken chat images** — Markdown `![]()` images now keep local, `file:`, and `data:` sources and load them as data URLs instead of being stripped or fetched as web paths. A bare `image-preview` JSON spec without fences is promoted into the existing preview renderer so screenshots show as images instead of a code block. Missing or unreadable files show an explicit error. Fixes #358.

- **Automation creation context isolation** — Scheduled, app-event, and agent-event creation dialogs now use separate category contexts and titles. Unfinished drafts remain resumable, new automation requests no longer inherit completed creation conversations, and detail edits target the selected rule ID. Fixes #362.

- **Live answer stays on the card** — Unclassified streaming tokens grow on the main reply instead of being marked as commentary and replayed after `submit_answer`. Finished text is classified only by protocol fields, and a whitespace-only thought keeps the live header identity until the first tool joins. Fixes #404.
