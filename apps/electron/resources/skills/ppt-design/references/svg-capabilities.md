# SVG：嵌入图片不等于转为原生形状

## 已观测能力：OfficeCLI v1.0.157

Selection 固定版本的实际探测结果：SVG 作为 picture 插入时，保存 OOXML 为 **`p:pic`**，扩展引用 **`asvg:svgBlip`**，同时带 **1×1 PNG fallback**。这是 SVG 图片嵌入，不是将 SVG 内部每个 path、rect、text 转成可分别编辑的 PowerPoint 原生形状。

当前 `officecli help` 没有可用于此目的的 `convert` picture 属性；不要猜写 `convert=true`、`editable=true`、`native=true` 或声称存在 SVG→shape 转换开关。探测了 picture 嵌入也不代表 `compose.ts` 的 `image-text` 入口支持 SVG；当前配方图像入口使用 PNG/JPEG，具体以当前验证器为准。

## 对本技能的影响

- 固定坐标配方直接通过 OfficeCLI 创建原生文本、几何、连接线及数据图表；可编辑能力来自这些原生对象，不来自一张整页 SVG。
- 有必要嵌入用户 SVG 时按当前 OfficeCLI picture 语法操作，并明确标为“嵌入 SVG 图片”；不能承诺内部元素可编辑。
- 1×1 PNG fallback 不能代表完整高质量的栅格预览。支持 SVG 的渲染器可能正确显示，但不支持该扩展的查看器可能显示异常；必须检查实际目标/可用查看器的真实画面，不能仅凭 OOXML 内有 SVG 就通过 G4。
- 不把整页栅格或 SVG 用作溢出/缺字/可编辑性问题的规避，不把图片内文字读不到当作无内容问题。
- 图片素材的授权、来源、alt 与显示正确性仍需记录。不会为此复制上游 assets、图标库或安装 SVG/Python 转换工具。

## 第二轮做法：直接写原生形状

研究了 ppt-master 的 layout SVG 与官网示例之后，各套风格的构图直接写成 OfficeCLI 原生形状，而不是增加 SVG 转换器。文字、矩形、椭圆、圆角矩形和图表都是可编辑对象。没有把整页 SVG 或截图贴进幻灯片。

## 尚未实现：通用 SVG 转换

未来若需要任意 SVG→原生形状，必须先明确转换器能力、文字与字体保真、路径/渐变/裁切/分组的映射，以及 round-trip 和真实截图验收，再实现并验证。当前没有通用转换器；上面的原生构图不是这条管线。
