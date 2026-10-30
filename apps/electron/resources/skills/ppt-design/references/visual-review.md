# 逐页视觉检查

`deck_check` 只处理越界、重叠、容量、对比度、孤字、字面量换行、瀑布不轧平和中文误用 `$latin`。它不判断疏密、图表是否像默认表格、连线有没有接到该接的节点、页脚是否对齐，也不判断这页是否真的在论证。

### G4 检查范围（O2）

新稿、整套换皮或没有有效既往视觉证据时检查全部页。局部文字/单页/指定页版式修订，仅重新截图并原生读图受影响页；记录页码、修改内容和沿用的未改页证据。主题/字体等全局修改检查全部页；页序重排检查受影响的叙事顺序与页面。无法证明未改页未受影响时扩大到全量。

已知总页数 N，局部截图使用 `deck-cli.mjs screenshot <pptx> --out <dataFolderPath>/slides --pages N --only-pages 2,4`，列表为从 1 开始的实际页码，保持原文件名，不重编号、不覆盖无关截图。直接 CLI 定点修改也可逐页调用 OfficeCLI screenshot。截图不是视觉验收，仍需 Read 或 call_llm attachments 原生读图。

后文的每轮检查均指本节确定的范围。首次与至多两次修复复查共用原三次上限，不因范围缩小、换会话或换 renderer 而重置；检查后修改使对应页证据失效，不允许复用过期截图宣称通过。

## 按当前模型的读图能力看截图

先看 `<session_state>` 的 `imageInput`，再看 Read 或 `call_llm` 的实际返回。

- `imageInput: enabled`，且读图调用把图片交回了模型：用这个结果做 G4。每一页用 Read 打开截图，或用 `call_llm` 把该 PNG/JPEG/WebP 放进 `attachments`。只写路径、不附图片，不算看过。
- `imageInput: unavailable`，或调用返回 `image_capability_mismatch`：这一页不能做视觉检查。写明 G4 未通过，不要假装看过画面。

两种结果都不要改用 OCR 冒充读图，包括 Swift/Vision（`VNRecognizeTextRequest`）、tesseract，以及名为 `Swift: OCR` 或 `OCR New Pages` 的步骤。`view text`、HTML 和接触表也不能代替看图。

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.

`imageInput: enabled` 时，G4 仍然要打开**检查范围内每一页**的截图，而不是只看接触表。整项任务最多三次：第一次检查，加上最多两次「修改后再看完受影响页面」。更换渲染器或审查者都不重新计数。第三次仍有问题，或根本没有截图：写明页码和阻塞，不能声称可交付。不能读图时不消耗“再看一次”去换 OCR。

每一页看这些：

- 主张是否一眼能读到，主数字是否够大。
- 标题、正文、来源、页码是否还在风格规定的位置。相邻页可以同一版式，节奏由叙事决定。
- 文本没有挤出形状，也没有为了塞下而缩成说明字。
- 图表的轴、网格和类别能读；瀑布的浮动柱和旁边的数字是同一件事。
- 连线和色条对得上句子。闸门没有被不该跨过去的条挡住。
- 来源还在，示例句和虚构专名已经换成用户材料。
- 封面和收束页用的是这一套自己的构图。发丝网格和 8 pt 以内的圆点是装饰，不应当成挡住正文的线。
- 中文 `dsh-course-workshop` 第 3 页和 `dsh-engineering-blueprint` 第 3 页的源标题会在末行落下一个字。换成用户句子后，截图里末行必须不是单字。

截图只能证明静态页面。没有在 PowerPoint、Keynote 或 WPS 里播放过的动画或 Morph，要明确说未验证。
