# 逐页视觉检查

`deck_check` 只处理越界、重叠、容量、对比度、孤字、字面量换行、相邻版式重复、瀑布不轧平和中文误用 `$latin`。它不判断疏密、图表是否像默认表格、连线有没有接到该接的节点、页脚是否对齐，也不判断这页是否真的在论证。

## 按当前模型的读图能力看截图

先看 `<session_state>` 的 `imageInput`，再看 Read 或 `call_llm` 的实际返回。

- `imageInput: enabled`，且读图调用把图片交回了模型：用这个结果做 G4。每一页用 Read 打开截图，或用 `call_llm` 把该 PNG/JPEG/WebP 放进 `attachments`。只写路径、不附图片，不算看过。
- `imageInput: unavailable`，或调用返回 `image_capability_mismatch`：这一页不能做视觉检查。写明 G4 未通过，不要假装看过画面。

两种结果都不要改用 OCR 冒充读图，包括 Swift/Vision（`VNRecognizeTextRequest`）、tesseract，以及名为 `Swift: OCR` 或 `OCR New Pages` 的步骤。`view text`、HTML 和接触表也不能代替看图。

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.

`imageInput: enabled` 时，G4 仍然要打开**每一页**的截图，而不是只看接触表。整项任务最多三次：第一次检查，加上最多两次「修改后再看完全部页面」。更换渲染器或审查者都不重新计数。第三次仍有问题，或根本没有截图：写明页码和阻塞，不能声称可交付。不能读图时不消耗“再看一次”去换 OCR。

每一页看这些：

- 主张是否一眼能读到，主数字是否够大。
- 标题、正文、来源、页码是否还在风格规定的位置。相邻页没有同一版式。
- 文本没有挤出形状，也没有为了塞下而缩成说明字。
- 图表的轴、网格和类别能读；瀑布的浮动柱和旁边的数字是同一件事。
- 连线和色条对得上句子。闸门没有被不该跨过去的条挡住。
- 来源还在，示例句和虚构专名已经换成用户材料。
- 封面和收束页用的是这一套自己的构图。发丝网格和 8 pt 以内的圆点是装饰，不应当成挡住正文的线。
- 中文 `dsh-course-workshop` 第 3 页和 `dsh-engineering-blueprint` 第 3 页的源标题会在末行落下一个字。换成用户句子后，截图里末行必须不是单字。

截图只能证明静态页面。没有在 PowerPoint、Keynote 或 WPS 里播放过的动画或 Morph，要明确说未验证。
