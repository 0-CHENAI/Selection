# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **PPT 局部修订闭环** — 实时导出也先做 deck 检查，失败保留上次可用文件；支持受影响页截图与局部 G4，允许连续同版式并补充叙事组合指引。Issue #685。

- **PPT 跟进修订路由** — 已有工程的跟进消息使用独立修订上下文，不再重复注入新建指令；明确文字/数据定点编辑、deck 版式修订与显式整套换风格的边界。Issue #684。

- **Office 业务案例** — 新增会议纪要、工作通知和执行台账指引，采用模板副本与段落/单元格定点修改，保留页眉页脚、样式和公式；继续使用 OfficeCLI。（#688）

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

- **Smart Approval replaces Ask to Edit** — The middle permission mode (智能审批, with a new shield icon) now asks only when an action is risky. Edits inside the working directory and session folder, read-only commands, and routine development commands (tests, builds, lint, formatting, `git add`/`commit`/`fetch`, `mkdir`) run without a prompt. Writes outside the working directory, sensitive files (`.env`, keys, credentials, `.git` internals), deleting or irreversible commands (`rm`, `git push`/`reset`), installs, `sudo` and external side effects (network uploads, MCP and API mutations) still ask, as does anything that cannot be classified. A home-directory or root working directory is never treated as trusted, and symlinks cannot escape it. "Always allow" now actually remembers the approval for the rest of the session, scoped to the exact command, directory or tool rather than a whole tool type. The internal mode id stays `ask`, so saved sessions and settings keep working.

- **Full Takeover risk warning** — Switching a workspace into Full Takeover now shows a confirmation that explains the reduced prompts and requires ticking "I understand the risk" before the mode is enabled. The acknowledgement is stored per workspace, so later switches in that workspace go through silently; other workspaces ask once. Approving a plan now elevates Explore to Smart Approval instead of silently enabling Full Takeover.

## Improvements

- **模板与按页修订** — PPT 模板库补齐 11 套中英文 DSH 模板及逐页预览；成果文件可按页描述修改，或直接选择结构诊断问题修复，保留其余页与主题。（#686）

- **先理解外来演示稿** — 编辑已有 PPTX 前先读取逐页结构摘要、定位原对象并核验文件版本，减少误改与无必要重建；摘要明确保真边界，不代表更换编辑器。（#687）

- **Max 思考强度与 Fast** — 桌面模型菜单和紧凑选择器共用思考强度滑轨；仅 Max 显示圆角方格 WebGL 点燃、拖尾与辉光，其他档位保持普通轨道。方格轮廓在辉光合成后重新裁切，减少动态效果时显示静态画面，离开 Max 或关闭菜单即释放渲染资源。保留 GPT OAuth Fast 的独立会话持久化，并补齐 #681 的闪电开关、忙碌和不支持状态；Fast 不改变思考强度。

- **PPT 中途附件** — PPT 会话生成之后仍可从输入栏附加图片和文件，也可以粘贴截图，或把文件拖到已打开的 Office 预览上。没有选中元素时，附件按普通对话保存进会话并交给模型。已经选中元素时会说明定向修改不能同时带附件，而不是静默禁用。Fixes #669.

- **开发启动与加载布局** — 修复 Vite 冷启动把共享 debug 工具中的主进程日志 transport 扫进 renderer、导致 `https` 预构建报错的问题；主进程继续接收文件日志。启动 HTML 在业务脚本和 CSS 加载前约束根容器，消除初始 loading 页的意外页面滚动条，消息与模板详情仍保留内部滚动。增加真实冷预构建和完整 NORM/PPT 导航回归。

- **PPT 输入栏** — 独立 PPT 模式隐藏重复的 PPT 和 PRO 标签，恢复数据源与工作目录入口。选择会用于实际生成，目录可清除；独立会话发送后的新草稿不再沿用上一会话的数据源和目录，项目会话仍使用原绑定目录。

- **PPT 与 Office 协同布局** — PPT 模式打开 Office 协同后会先收起中间的历史列表，同一窗口里手动展开或收起后不再被自动改回去，关闭面板时只恢复那一次自动收起。聊天列至少保留约 560px，Office 面板的默认宽度和拖拽都不能把它挤得更窄；输入栏放不下时按钮换行。右侧预览在文档排完和列宽变化之后按页宽重算，不会停在放大裁切的画面上。换配色和换风格从 0 页计进度。Fixes #655.

- **PPT 进度并入成果文件** — 聊天列不再单独放一张带封面和缩略图的 PPT 卡片。pptx 是成果文件卡里的一行，样式与 docx、xlsx 相同。生成时副标题显示当前页，行底有一条 2px 进度线，行尾可以停止。完成后副标题显示全部通过，或用一行状态写出需留意的页。换风格重排、换配色和打开方式收进行尾菜单，不再逐页列出检查结果。换风格和换配色仍可对比封面。右侧 Office 协同面板的标题栏不变。Fixes #661.

- **PPT 外部图表技能** — 图表默认是原生可编辑图表。只有用户在需求里明确点名已安装的图表技能（例如「用 lieflat-charts 画图」）时，才会调用该技能：套用模板主题色，插入 SVG 或高清 PNG，并把原始数据写入备注。技能缺失、失败或超时时改回原生图表，并在侧窗提示。没有点名时不会调用，也不会询问。应用只检测本机已安装的图表技能，不打包这些技能。Part of #628.

- **PPT 论证版式与真实模板预览** — 声明式页面现在可以直接调用 14 类论证版式（结论、证据树、矩阵、瀑布、趋势、计分、甘特、架构、对照、漏斗、流程、时间线、收束、取舍），并导出跟随模板主题的面积、散点、气泡、雷达、柱线组合、堆积和百分比堆积图。图表在 960×540 上拉开字号：页标题约 26pt，类别轴 13pt，左右数值轴刻度都是 12pt 且比辅助色更深，图例和数据标注 12pt；数值轴最大值和步长取整。柱、条、瀑布、饼和圆环标出数值，折线和面积只标高低点，饼和圆环用引出线。柱线组合的折线点落在柱心，端点数值留在图内。轴线用主题浅灰，默认不再铺网格。瀑布图分成起点、增减和合计，增减用颜色和正负号区分。自定义模板库会逐页保存原 PPTX 的画面；渲染不可用时仍保留原来的几何草图。Part of #628.

- **PPT 声明式页面** — 新建或整套重设计演示文稿时，先写可预检的页面描述，再导出可编辑的 PPTX。随附五套改编自 DSH Desktop v0.2.21 的参考风格（中英各 12 页），ppt-master 的七套版式、十四套风格说明、十二套自有色彩主题，以及 ppt-master-examples 里全部 70 套官方成稿。其中 9 套保留来源中的商标与官方标识，只作参考模板；Selection 本体仍为 Apache-2.0，并按非商业用途提供，纳入这些页面不授予商标权利。成稿保留文字、形状、路径、渐变和图片，画布覆盖 16:9、4:3、A4、方形、竖版和横幅。16:9 仍是 960×540 pt。预检不过就不写出文件。局部修改仍走原来的 OfficeCLI 路径。Refs #631，并取代尚未发布的三套配方版式（#626）。

- **Independent premise review and research stages** — New research plans record conditions that could overturn important conclusions, independent premise critiques and explicit decisions for alternative-premise candidates. Fact repairs remain on their original line; local reports can complete while unrelated lines continue. Stage readiness follows current evidence, review and issue disposition, independently of worker completion. Older records explicitly show missing judgment history. Issue #449.

- **Fair model request concurrency** — Conversations, coordinators, workers and utility calls now share host-owned request slots by provider account and endpoint. Queues rotate between runs, release slots during rate-limit backoff, honor Retry-After, and adapt concurrency after throttling. Waiting time is excluded from the active request timeout; cancellation returns queued and active slots. Codex uses its supported SSE transport so requests participate in the same accounting.

- **Compact artifact history** — File changes requested in chat are recorded automatically. Version history shows version numbers, short identifiers, summaries and previews, without a separate edit form or explanatory paragraphs. Existing primary files retain their own history when alternative recovery paths refer to another file.

- **Interactive HTML artifacts** — HTML files and `html-preview` entries now open in the built-in browser with working scripts, animation and relative assets. Generated pages use temporary isolated browser sessions. The previous HTML iframe preview and its custom zoom controls are removed. Version previews open the selected document snapshot; separate resource files are not archived.

- **Safer Office document edits** — Bundled OfficeCLI is updated to v1.0.157 with matching official guides and Windows runtime verification, including upstream PowerPoint fixes for centered title inheritance, hidden shapes and master decoration layering. After a warned or failed write, the agent checks for partial changes before retrying so it does not duplicate document content. PRs #417, #477 and #492.

- **Simpler settings** — The Input page, spell check, send-key choice, and project color highlight are removed. Connection icons are now labeled provider icons, and an empty default-sources section uses the same settings card as the other rows. Advanced settings store an optional AnySearch API key locally without showing the saved value. PRO now provides orchestration in standard builds, with an explicit build override for disabling it. Fixes #413.

- **Document previews** — HTML and Markdown inline cards show file identity and clear boundaries; full content opens in a scrollable preview dialog without expanding the conversation. Keyboard focus returns to the opener after closing. Fixes #409.

- **Interactive tables by default** — Tabular answers and comparisons prefer the built-in datatable renderer, including small datasets. Spreadsheet export and explicitly requested Markdown output remain available.

- **Stable reference sources** — Numbered, emphasized, bare-URL and reference-style citations no longer flash in streaming replies. Known sources reserve their footer space so completion does not resize the answer card.

- **Leaner agent context** — Rendering guides load on demand, duplicate Pi tool aliases are omitted from model requests while remaining executable, and context usage distinguishes estimated skill catalogs from loaded content. Swarm delegation follows one session policy.

- **Natural document writing** — Prose drafting and revision can load a built-in writing skill to reduce formulaic language while preserving facts, citations, and the requested voice. Explicitly selecting the bundled `natural-writing` supplies its instructions for the whole turn, including context compaction. Ordinary chat, code, verbatim quotes or translation, and formatting-only tasks do not automatically load its body.

- **Humanizer skills** — `natural-writing` now carries the full Humanizer-zh guide for Chinese prose and keeps that directory id. English blogs, docs, replies, and pull-request text use `humanizer`. English papers, theses, rebuttals, and grant proposals use `academic-humanizer`. Academic Word layout stays with the OfficeCLI academic-paper guide. Issue #624.

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

- **PPT 导出结构校验** — 修正备注母版列表的 OOXML 顺序，保留备注、母版和页面关系，避免生成的演示稿在 OfficeCLI 校验时报告结构错误。Issue #689。

- **Office 整合修复** — 跟进修改不再用输入框残留参数回退已选风格或配色；打开已有 PPTX 时不再注入新建指令，按页文字修改保留 OfficeCLI 定点路径。补齐模板来源、完整 MIT/Apache 许可与随包 NOTICE，保留 Max WebGL 与独立 Fast 行为。（#698）

- **PPT 视觉检查跟随读图能力** — 会话状态写明当前模型能否看图。能看图时，幻灯片截图用 Read 或带图片的 `call_llm`。不能看图时沿用原来的图像能力提示，G4 停在未通过，不再静默改走 OCR 或名为 “OCR New Pages” 的步骤。Fixes #671.

- **Office 选区胶囊重新可见** — 在右侧预览里选中 Word、Excel 或 PowerPoint 元素后，底部再次显示「已选 N / 256」。实时预览把文档画在更高的层上，把这颗胶囊盖住了；现在胶囊浮在文档之上。取消选择后数量回到 0，超过 256 个仍标红并警告。点击幻灯片仍只描边，不会把铺底形状抬到文字上面。Fixes #667.

- **Office 协同点击幻灯片不再清空该页** — 在右侧预览里点中一整页时，页面和缩略图保持原样。选中只画描边，不再把铺底的形状抬到文字上面。点击也不会改写磁盘上的 pptx。Fixes #662.

- **OAuth callback pages use the Selection swan** — After ChatGPT, Google, Slack, Microsoft, MCP, and WebUI authorization, the local success and error pages still showed the Craft pixel logo. Those pages now use the Selection swan for the logo and favicon. The label under the swan reads Selection in the bundled CATHALIE face, and the browser tab title says Selection.

- **Faster mode switching** — Switching between NORM and PRO opens the selected mode's new-conversation composer instead of restoring its last conversation. Each mode keeps its own draft and input settings. Content cross-fades in 150 ms without large-area blur; navigation cancellation, reduced-motion support and older-runtime fallback remain available.

- **Virtualized long conversations** — Messages load on first approach to the viewport. Already loaded content keeps its DOM and component state throughout the conversation; offscreen content skips layout and paint. Switching conversations releases the previous cache. Measured row heights preserve the full scrollbar and reading position. Search, conversation records and annotation jumps retain full-history indexing. Returning to the bottom resumes streaming follow. Unchanged reply Markdown is memoized; restored history skips paragraph reveal scans, empty annotation updates and repeated outline text parsing.

- **Session-scoped Office discovery** — The Office collaboration shortcut scans only the conversation's selected working directory and its own session files, including uploads and delivered documents. Unrelated application-workspace files and other conversations no longer enable the shortcut. Private drafts and QA copies remain excluded, even when the selected directory contains application storage.

- **Office collaboration shortcut** — An animated button beside Session Files appears when editable Office files are found in the workspace or current project. It lists available files as cards in the right sidebar, even for a single file; clicking a card opens its preview. Cards vertically center their file icons beside names bounded to 24 Unicode characters and two lines. Card titles omit Office extensions; icons identify the document type. A single path row below truncates with an ellipsis. A small copy icon at the end of that row copies the complete path without opening the document; hover hints retain the full path. Closing dismisses the description tooltip without reopening it on restored focus. It marks the expanded preview with the theme accent and a checkmark. Discovery excludes private drafts and respects the session host and workspace permissions; reduced-motion preferences are supported. Each workspace and conversation remembers whether the sidebar is open, its current file, and its reading position across navigation and app restarts. Up to five previews per host stay warm for six idle hours. Session switches retain the page and reading position while background polling pauses; returning reauthorizes the file and reuses unchanged previews. Idle previews are evicted first at capacity; explicit close releases the process, and changed or expired previews are rebuilt with cleared selections. The preview uses the same framed region, spacing and spring fade as reference sources, including compact layouts. Its opening animation clips only horizontal overflow, preserving the top shadow and panel outline above the title-bar layer; exiting keeps the visible snapshot until the animation finishes and reduced-motion preferences apply immediately. File switching sits beside a bounded filename with its own icon. Initial loading shows a centered document skeleton with gentle motion; resuming a cached preview keeps the document visible with a compact loading pill. Reduced-motion preferences stop the loading animation. Edits in progress use a centered floating status pill with a working animation and temporarily unavailable hint. A bottom pill shows only the selection count and 256-element limit; oversized selections warn in a dialog and cannot submit stale targets.
- **Office interactive revisions** — Selecting elements is optional: with the preview open, ordinary questions and whole-document requests carry the current file as context. Selected elements still use targeted revisions. Candidate edits are saved before each isolated Shell call finishes. Progress and delivery share one run identity, so completed revisions no longer leave a thinking indicator or repeat the child task's final report in progress bubbles. The full Markdown reply is delivered after publication; version-history titles are limited to 30 characters and wrap in full without ellipses. Older automatically truncated replies recover their saved revision text when reopening the chat. Version history retains the change summary.

- **Research source acquisition** — Source-backed plans index native documents before freezing their extracted versions; PDF bytes cannot be mistaken for plain text. Authors and independent reviewers still need their own original read receipts, and a late index never rewrites frozen history. Issue #474.

- **History replay entry** — Opening the latest durable frame accepts the JSON transport's empty cursor while retaining validation for invalid numeric cursors. Inspection remains read-only and never restarts models. Issue #474.

- **Isolated document reads** — Task workers can index and read originals in their host-authorized source directory while keeping Shell and file writes inside their isolated candidate directory. Native page, paragraph, cell and slide receipts remain version-bound. Issue #474.

- **Live work previews** — Collapsed work headers follow the latest actual activity instead of a pending downstream task whose status arrived later.

- **Async research progress** — Start acknowledgments keep their lightweight transcript style while waiting for the coordinator, verifying or repairing. Their dashed speech icon aligns with the work-chain icon column; final-answer actions appear only on completed answers, which retain their normal cards and controls.

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

- **Ordinary chat folder controls** — Open the system folder picker directly and clear a selected working folder with a borderless close button. Hover and keyboard focus fade only the folder name; touch keeps the action visible. Project folder bindings remain fixed.

- **Sharper PPT template previews** — Template details now render vector pages at the display's pixel density while keeping gallery thumbnails small. Distant pages unload as you scroll, preview memory has a fixed budget, and imported templates render detail pages from the original PPTX on demand.


