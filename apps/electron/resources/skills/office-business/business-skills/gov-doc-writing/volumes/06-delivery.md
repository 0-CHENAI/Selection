# 写入 Word

## 工具

1. 阅读 [OfficeCLI 路由](../../../officecli/SKILL.md)。
2. 执行 `officecli load_skill word`。
3. 不安装、不调用 python-docx，不使用 Python，不使用 LibreOffice Kit。

## 原件

`cases/government-notice/example.docx` 是用户提供的样例，含嵌入字体，只作版式参照。sha256 必须保持清单中的值。任何填写都发生在工作区副本上。

做同款时：

- 版头文字改成当前任务的发文机关名称，颜色保持红色。
- 标题换成当前事由和文种。
- 示例里已经标成「待补充」的项，在新稿中继续留空，除非用户这次提供了对应事实。
- 不把示例通知的机关名称、活动专题和正文句子写入新稿。

## 写入方式

先调用 `office_template(template_id="government-notice")`，拿到 `editable_paragraphs`。再用 `office_template_write` 写出新的 DOCX：

- replacements 按段落 ID 替换文字，版头发文机关必须在其中。
- additions 用 `style_from` 让新段落继承原样式。
- removals 只删 `can_remove=true` 的段落；版头、红线、绘图、分节和表格单元格受保护，宿主会拒绝。
- 宿主写出时跑 7 项版式守卫，交付前再跑一次。未通过不写文件、不能完成，按返回的诊断修正后重写。

页边距目标见 [05-layout.md](05-layout.md)。若 OfficeCLI 改动了节属性，读回 top/right/bottom/left，对照 2098/1474/1984/1587 twip。

## 不在本阶段做的事

PDF 导出和逐页渲染的实现路径尚未选定（#705）。交付前不要调用 PDF 后端，不要用 OCR 读页面。缺少页图时，结论写「视觉检查未做」，不要写成通过。

成品路径使用用户指定的位置；用户没指定时放在当前工作目录。中间文件放进会话的 `dataFolderPath`。由 Selection 的文件卡片呈现 DOCX，不调用其他产品的 present。
